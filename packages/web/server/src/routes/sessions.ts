import { Router } from 'express'
import { z } from 'zod'
import type { ApiResponse, ElementAttention } from '@gazekit/shared'
import { Session } from '../models/Session'
import { Page } from '../models/Page'
import { Slice } from '../models/Slice'
import { GazeEvent } from '../models/GazeEvent'
import { RrwebEvent } from '../models/RrwebEvent'
import { Screenshot } from '../models/Screenshot'
import { validateQuery } from '../middleware/validation'
import { config } from '../config/env'
import { filePathToUrl } from '../services/screenshotStore'
import fs from 'fs/promises'
import path from 'path'

export const sessionsRouter = Router()

const sessionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  url: z.string().optional(),
  userId: z.string().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
})

// GET /api/sessions — list sessions with pagination and filtering
sessionsRouter.get('/', validateQuery(sessionsQuerySchema), async (req, res, next) => {
  try {
    const query = req.query as unknown as z.infer<typeof sessionsQuerySchema>
    const page = query.page ?? 1
    const limit = query.limit ?? 20
    const skip = (page - 1) * limit

    const filter: Record<string, unknown> = {}

    if (query.url) {
      // v2 sessions have Page docs; v1 sessions have the legacy embedded
      // pages.url. Match either.
      const pageSessionIds = await Page.find({ url: query.url })
        .distinct('sessionId')
      filter.$or = [
        { sessionId: { $in: pageSessionIds } },
        { 'pages.url': query.url },
      ]
    }
    if (query.userId) {
      filter.userId = query.userId
    }
    if (query.from || query.to) {
      const dateFilter: Record<string, Date> = {}
      if (query.from) dateFilter.$gte = new Date(query.from)
      if (query.to) dateFilter.$lte = new Date(query.to)
      filter.startedAt = dateFilter
    }

    const [sessions, total] = await Promise.all([
      Session.find(filter).sort({ startedAt: -1 }).skip(skip).limit(limit).lean(),
      Session.countDocuments(filter),
    ])

    // v2 sessions store visited pages as first-class Page docs rather than the
    // legacy embedded `pages[]`. Synthesize that embedded shape (url/enteredAt/
    // leftAt) from the Page collection so the sessions list URL column renders
    // for both v1 (already embedded) and v2 sessions.
    type EmbeddedPage = { url: string; enteredAt: string; leftAt: string | null }
    const withPages = sessions as Array<
      (typeof sessions)[number] & { pages?: EmbeddedPage[] }
    >
    const needPages = withPages.filter((s) => !s.pages || s.pages.length === 0)
    if (needPages.length > 0) {
      const ids = needPages.map((s) => s.sessionId)
      const pageDocs = await Page.find({ sessionId: { $in: ids } })
        .sort({ sessionId: 1, pageIndex: 1 })
        .lean()
      const bySession = new Map<string, EmbeddedPage[]>()
      for (const p of pageDocs) {
        const arr = bySession.get(p.sessionId) ?? []
        arr.push({
          url: p.url,
          enteredAt: new Date(p.enteredAt).toISOString(),
          leftAt: p.leftAt ? new Date(p.leftAt).toISOString() : null,
        })
        bySession.set(p.sessionId, arr)
      }
      for (const s of needPages) {
        s.pages = bySession.get(s.sessionId) ?? []
      }
    }

    const response: ApiResponse<{
      sessions: typeof sessions
      total: number
      page: number
      limit: number
      totalPages: number
    }> = {
      success: true,
      data: {
        sessions,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    }

    res.json(response)
  } catch (err) {
    next(err)
  }
})

// GET /api/sessions/:id — get full session by sessionId
sessionsRouter.get('/:id', async (req, res, next) => {
  try {
    const session = await Session.findOne({ sessionId: req.params.id }).lean()
    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' })
      return
    }
    const response: ApiResponse<typeof session> = { success: true, data: session }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// DELETE /api/sessions/:id — delete session and all associated data
sessionsRouter.delete('/:id', async (req, res, next) => {
  try {
    const sessionId = req.params.id
    const session = await Session.findOne({ sessionId }).lean()
    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' })
      return
    }

    // On-disk screenshots live under screenshots/{sessionId}/... for both the
    // v2 (pageId/sliceIndex.png) and v1 (visitFolder/index.png) layouts, so
    // removing the session directory tree covers both. Mongo TTL only deletes
    // docs, never the referenced PNGs — this is the same manual-unlink gap the
    // cleanup job also has to cover.
    const sessionDir = path.join(config.dataDir, 'screenshots', sessionId)
    await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => {})

    await Promise.all([
      Session.deleteOne({ sessionId }),
      // v2 collections
      Page.deleteMany({ sessionId }),
      Slice.deleteMany({ sessionId }),
      // v1 collections (harmless no-ops for v2 sessions)
      GazeEvent.deleteMany({ 'meta.sid': sessionId }),
      RrwebEvent.deleteMany({ sessionId }),
      Screenshot.deleteMany({ sessionId }),
    ])

    res.json({ success: true, data: { deleted: sessionId } })
  } catch (err) {
    next(err)
  }
})

// GET /api/sessions/:id/elements — element attention ranking.
// v2 reads precomputed Slice.fixations; v1 falls back to the old inline
// gaze-gap grouping over GazeEvent.
sessionsRouter.get('/:id/elements', async (req, res, next) => {
  try {
    const sessionId = req.params.id
    const session = await Session.findOne({ sessionId }).lean()
    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' })
      return
    }

    const elements =
      session.schemaVersion === 2
        ? await elementsFromSlices(sessionId)
        : await elementsFromGazeEvents(sessionId)

    const response: ApiResponse<ElementAttention[]> = { success: true, data: elements }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// v2: aggregate precomputed fixations by element selector.
async function elementsFromSlices(sessionId: string): Promise<ElementAttention[]> {
  const slices = await Slice.find({ sessionId }).select({ fixations: 1 }).lean()

  const map = new Map<
    string,
    { selector: string; tag: string; text: string; totalDwellMs: number; fixationCount: number; firstFixationTs: number }
  >()

  for (const slice of slices) {
    for (const f of slice.fixations ?? []) {
      const sel = f.el?.sel
      if (!sel) continue
      const ts = f.startTs ? new Date(f.startTs).getTime() : 0
      const existing = map.get(sel)
      if (!existing) {
        map.set(sel, {
          selector: sel,
          tag: f.el?.tag ?? '',
          text: (f.el?.txt ?? '').substring(0, 100),
          totalDwellMs: f.durationMs ?? 0,
          fixationCount: 1,
          firstFixationTs: ts,
        })
      } else {
        existing.totalDwellMs += f.durationMs ?? 0
        existing.fixationCount += 1
        if (ts < existing.firstFixationTs) existing.firstFixationTs = ts
      }
    }
  }

  const grandTotal = [...map.values()].reduce((sum, d) => sum + d.totalDwellMs, 0)
  return [...map.values()]
    .map((d) => ({
      selector: d.selector,
      tag: d.tag,
      text: d.text,
      totalDwellMs: d.totalDwellMs,
      fixationCount: d.fixationCount,
      avgFixationMs: d.fixationCount > 0 ? Math.round(d.totalDwellMs / d.fixationCount) : 0,
      firstFixationTs: d.firstFixationTs,
      percentOfTotalDwell:
        grandTotal > 0 ? Math.round((d.totalDwellMs / grandTotal) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.totalDwellMs - a.totalDwellMs)
}

// v1: legacy inline 200ms-gap dwell grouping over raw GazeEvent docs.
async function elementsFromGazeEvents(sessionId: string): Promise<ElementAttention[]> {
  const gazeEvents = await GazeEvent.find({
    'meta.sid': sessionId,
    'el.sel': { $exists: true, $ne: null },
  })
    .sort({ ts: 1 })
    .lean()

  const elementMap = new Map<
    string,
    {
      selector: string
      tag: string
      text: string
      totalDwellMs: number
      fixationCount: number
      firstFixationTs: number
      dwellPeriods: Array<{ start: number; end: number }>
    }
  >()

  const FIXATION_GAP_MS = 200

  for (const event of gazeEvents) {
    if (!event.el?.sel) continue
    const selector = event.el.sel
    const eventTs = event.ts ? new Date(event.ts).getTime() : 0
    const existing = elementMap.get(selector)
    if (!existing) {
      elementMap.set(selector, {
        selector,
        tag: event.el.tag ?? '',
        text: (event.el.txt ?? '').substring(0, 100),
        totalDwellMs: 0,
        fixationCount: 1,
        firstFixationTs: eventTs,
        dwellPeriods: [{ start: eventTs, end: eventTs }],
      })
    } else {
      const lastPeriod = existing.dwellPeriods[existing.dwellPeriods.length - 1]
      if (lastPeriod && eventTs - lastPeriod.end < FIXATION_GAP_MS) {
        lastPeriod.end = eventTs
      } else {
        existing.dwellPeriods.push({ start: eventTs, end: eventTs })
        existing.fixationCount++
      }
    }
  }

  let grandTotalDwell = 0
  for (const [, data] of elementMap) {
    data.totalDwellMs = data.dwellPeriods.reduce((sum, p) => sum + (p.end - p.start), 0)
    grandTotalDwell += data.totalDwellMs
  }

  return Array.from(elementMap.values())
    .map((data) => ({
      selector: data.selector,
      tag: data.tag,
      text: data.text,
      totalDwellMs: data.totalDwellMs,
      fixationCount: data.fixationCount,
      avgFixationMs:
        data.fixationCount > 0 ? Math.round(data.totalDwellMs / data.fixationCount) : 0,
      firstFixationTs: data.firstFixationTs,
      percentOfTotalDwell:
        grandTotalDwell > 0
          ? Math.round((data.totalDwellMs / grandTotalDwell) * 10000) / 100
          : 0,
    }))
    .sort((a, b) => b.totalDwellMs - a.totalDwellMs)
}

// GET /api/sessions/:id/screenshots — list screenshots for a session.
// v2 sources from Slice; v1 from the legacy Screenshot collection.
sessionsRouter.get('/:id/screenshots', async (req, res, next) => {
  try {
    const sessionId = req.params.id
    const session = await Session.findOne({ sessionId }).lean()
    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' })
      return
    }

    if (session.schemaVersion === 2) {
      const slices = await Slice.find({ sessionId })
        .sort({ capturedAt: 1 })
        .select({ sliceIndex: 1, pageId: 1, capturedAt: 1, screenshot: 1 })
        .lean()
      const data = slices.map((s) => ({
        index: s.sliceIndex ?? 0,
        pageId: String(s.pageId),
        scrollY: s.screenshot?.scrollY ?? 0,
        viewportHeight: s.screenshot?.viewportHeight ?? 0,
        capturedAt: s.capturedAt,
        screenshotUrl: filePathToUrl(s.screenshot?.filePath),
      }))
      res.json({ success: true, data })
      return
    }

    const filter: Record<string, unknown> = { sessionId }
    const urlParam = req.query.url as string | undefined
    if (urlParam) filter.url = urlParam

    const screenshots = await Screenshot.find(filter).sort({ capturedAt: 1 }).lean()
    const data = screenshots.map((s, i) => {
      let screenshotUrl: string | null = null
      if (s.filename && s.visitFolder) {
        screenshotUrl = `/api/screenshots/${sessionId}/${s.visitFolder}/${s.filename}`
      } else if (s.filename) {
        screenshotUrl = `/api/screenshots/${sessionId}/${s.filename}`
      } else if (s.filePath) {
        screenshotUrl = `/api/screenshots/${s.filePath.split('/').pop()}`
      }
      return {
        index: s.index ?? i,
        visitIndex: s.visitIndex,
        visitFolder: s.visitFolder,
        url: s.url,
        scrollY: s.scrollY,
        viewportHeight: s.viewportHeight,
        capturedAt: s.capturedAt,
        screenshotUrl,
      }
    })

    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})
