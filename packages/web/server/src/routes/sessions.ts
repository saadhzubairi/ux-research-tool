import { Router } from 'express'
import { z } from 'zod'
import type { ApiResponse, SessionsQuery, ReplayData, ElementAttention, CalibrationResult } from '@gazekit/shared'
import { Session } from '../models/Session'
import { GazeEvent } from '../models/GazeEvent'
import { RrwebEvent } from '../models/RrwebEvent'
import { Screenshot } from '../models/Screenshot'
import { validateQuery } from '../middleware/validation'
import fs from 'fs/promises'

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
sessionsRouter.get(
  '/',
  validateQuery(sessionsQuerySchema),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as z.infer<typeof sessionsQuerySchema>
      const page = query.page ?? 1
      const limit = query.limit ?? 20
      const skip = (page - 1) * limit

      const filter: Record<string, unknown> = {}

      if (query.url) {
        filter['pages.url'] = query.url
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
        Session.find(filter)
          .sort({ startedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Session.countDocuments(filter),
      ])

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
  }
)

// GET /api/sessions/:id — get full session by sessionId
sessionsRouter.get('/:id', async (req, res, next) => {
  try {
    const session = await Session.findOne({ sessionId: req.params.id }).lean()

    if (!session) {
      res.status(404).json({
        success: false,
        error: 'Session not found',
      })
      return
    }

    const response: ApiResponse<typeof session> = {
      success: true,
      data: session,
    }

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
      res.status(404).json({
        success: false,
        error: 'Session not found',
      })
      return
    }

    const screenshots = await Screenshot.find({ sessionId }).lean()
    for (const screenshot of screenshots) {
      if (screenshot.filePath) {
        try {
          await fs.unlink(screenshot.filePath)
        } catch {
          // File may already be deleted
        }
      }
    }

    // Try to clean up the session screenshot directory
    const sessionDirs = new Set(
      screenshots
        .filter(s => s.filePath)
        .map(s => {
          const parts = s.filePath!.split('/')
          parts.pop()
          return parts.join('/')
        })
    )
    for (const dir of sessionDirs) {
      try {
        await fs.rmdir(dir)
      } catch {
        // Directory may not be empty or may not exist
      }
    }

    await Promise.all([
      Session.deleteOne({ sessionId }),
      GazeEvent.deleteMany({ 'meta.sid': sessionId }),
      RrwebEvent.deleteMany({ sessionId }),
      Screenshot.deleteMany({ sessionId }),
    ])

    res.json({
      success: true,
      data: { deleted: sessionId },
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/sessions/:id/replay — return replay data
sessionsRouter.get('/:id/replay', async (req, res, next) => {
  try {
    const sessionId = req.params.id
    const session = await Session.findOne({ sessionId }).lean()

    if (!session) {
      res.status(404).json({
        success: false,
        error: 'Session not found',
      })
      return
    }

    const [rrwebBatches, gazeEvents] = await Promise.all([
      RrwebEvent.find({ sessionId })
        .sort({ batchIndex: 1 })
        .lean(),
      GazeEvent.find({ 'meta.sid': sessionId })
        .sort({ ts: 1 })
        .select({ ts: 1, x: 1, y: 1, conf: 1 })
        .lean(),
    ])

    const rrwebEvents = rrwebBatches.flatMap(batch => {
      if (Array.isArray(batch.events)) return batch.events as unknown[]
      return []
    })

    const gazeTimeline = gazeEvents.map(e => ({
      ts: e.ts ? new Date(e.ts).getTime() : 0,
      x: e.x ?? 0,
      y: e.y ?? 0,
      conf: e.conf ?? null,
    }))

    const replayData: ReplayData = {
      session: {
        sessionId: session.sessionId,
        userId: session.userId ?? 'anonymous',
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt ? session.endedAt.toISOString() : null,
        durationMs: session.durationMs ?? null,
        device: {
          userAgent: session.device?.userAgent ?? '',
          screenWidth: session.device?.screenWidth ?? 0,
          screenHeight: session.device?.screenHeight ?? 0,
          dpr: session.device?.dpr ?? 1,
        },
        webcam: {
          label: session.webcam?.label ?? '',
          resolution: {
            w: session.webcam?.resolution?.w ?? 0,
            h: session.webcam?.resolution?.h ?? 0,
          },
        },
        calibration: {
          method: (session.calibration?.method as CalibrationResult['method']) ?? '9-point',
          avgErrorPx: session.calibration?.avgErrorPx ?? 0,
          precisionPx: session.calibration?.precisionPx ?? 0,
          qualityScore: session.calibration?.qualityScore ?? 0,
          screenWidth: session.calibration?.screenWidth ?? 0,
          screenHeight: session.calibration?.screenHeight ?? 0,
          dpr: session.calibration?.dpr ?? 1,
          calibratedAt: session.calibration?.calibratedAt
            ? new Date(session.calibration.calibratedAt).toISOString()
            : new Date().toISOString(),
        },
        tracking: {
          library: 'webgazer',
          version: session.tracking?.version ?? '',
          regressionModel: 'ridge',
          avgFps: session.tracking?.avgFps ?? 0,
        },
        pages: (session.pages ?? []).map(p => ({
          url: p.url ?? '',
          enteredAt: p.enteredAt ? new Date(p.enteredAt).toISOString() : '',
          leftAt: p.leftAt ? new Date(p.leftAt).toISOString() : null,
        })),
        stats: {
          totalGazePoints: session.stats?.totalGazePoints ?? 0,
          trackingLossSeconds: session.stats?.trackingLossSeconds ?? 0,
          avgConfidence: session.stats?.avgConfidence ?? 0,
        },
      },
      rrwebEvents,
      gazeTimeline,
    }

    const response: ApiResponse<ReplayData> = {
      success: true,
      data: replayData,
    }

    res.json(response)
  } catch (err) {
    next(err)
  }
})

// GET /api/sessions/:id/elements — element attention ranking
sessionsRouter.get('/:id/elements', async (req, res, next) => {
  try {
    const sessionId = req.params.id
    const session = await Session.findOne({ sessionId }).lean()

    if (!session) {
      res.status(404).json({
        success: false,
        error: 'Session not found',
      })
      return
    }

    const gazeEvents = await GazeEvent.find({
      'meta.sid': sessionId,
      'el.sel': { $exists: true, $ne: null },
    }).sort({ ts: 1 }).lean()

    const elementMap = new Map<string, {
      selector: string
      tag: string
      text: string
      totalDwellMs: number
      fixationCount: number
      firstFixationTs: number
      dwellPeriods: Array<{ start: number; end: number }>
    }>()

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
      data.totalDwellMs = data.dwellPeriods.reduce(
        (sum, p) => sum + (p.end - p.start),
        0
      )
      grandTotalDwell += data.totalDwellMs
    }

    const elements: ElementAttention[] = Array.from(elementMap.values())
      .map(data => ({
        selector: data.selector,
        tag: data.tag,
        text: data.text,
        totalDwellMs: data.totalDwellMs,
        fixationCount: data.fixationCount,
        avgFixationMs: data.fixationCount > 0
          ? Math.round(data.totalDwellMs / data.fixationCount)
          : 0,
        firstFixationTs: data.firstFixationTs,
        percentOfTotalDwell: grandTotalDwell > 0
          ? Math.round((data.totalDwellMs / grandTotalDwell) * 10000) / 100
          : 0,
      }))
      .sort((a, b) => b.totalDwellMs - a.totalDwellMs)

    const response: ApiResponse<ElementAttention[]> = {
      success: true,
      data: elements,
    }

    res.json(response)
  } catch (err) {
    next(err)
  }
})

// GET /api/sessions/:id/screenshots — list screenshots for session
sessionsRouter.get('/:id/screenshots', async (req, res, next) => {
  try {
    const sessionId = req.params.id
    const session = await Session.findOne({ sessionId }).lean()

    if (!session) {
      res.status(404).json({
        success: false,
        error: 'Session not found',
      })
      return
    }

    const screenshots = await Screenshot.find({ sessionId })
      .sort({ capturedAt: 1 })
      .lean()

    const screenshotData = screenshots.map(s => ({
      url: s.url,
      scrollY: s.scrollY,
      viewportHeight: s.viewportHeight,
      capturedAt: s.capturedAt,
      screenshotUrl: s.filePath
        ? `/api/screenshots/${s.filePath.split('/').pop()}`
        : null,
    }))

    const response: ApiResponse<typeof screenshotData> = {
      success: true,
      data: screenshotData,
    }

    res.json(response)
  } catch (err) {
    next(err)
  }
})
