import { Router } from 'express'
import { z } from 'zod'
import type { ApiResponse, Page as PageDTO, SliceListItem, Slice as SliceDTO } from '@gazekit/shared'
import { Session } from '../models/Session'
import { Page } from '../models/Page'
import { Slice } from '../models/Slice'
import { validateQuery } from '../middleware/validation'
import { filePathToUrl } from '../services/screenshotStore'
import { getLegacyPages, getLegacySlices } from '../services/legacyRead'

// Mounted at /api/sessions (shares the :id param namespace with sessionsRouter).
export const pagesRouter = Router({ mergeParams: true })

const slicesQuerySchema = z.object({
  from: z.coerce.number().int().optional(), // slice-index cutoff (inclusive)
  to: z.coerce.number().int().optional(),
  includePoints: z.coerce.boolean().optional(),
})

// GET /api/sessions/:id/pages — list Page docs for a session.
pagesRouter.get('/:id/pages', async (req, res, next) => {
  try {
    const sessionId = req.params.id
    const session = await Session.findOne({ sessionId }).lean()
    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' })
      return
    }

    let pages: PageDTO[]
    if (session.schemaVersion === 2) {
      const docs = await Page.find({ sessionId }).sort({ pageIndex: 1 }).lean()
      pages = docs.map((p) => ({
        _id: String(p._id),
        sessionId: p.sessionId,
        pageIndex: p.pageIndex ?? 0,
        url: p.url ?? '',
        enteredAt: p.enteredAt ? new Date(p.enteredAt).toISOString() : '',
        leftAt: p.leftAt ? new Date(p.leftAt).toISOString() : null,
        sliceCount: p.sliceCount ?? 0,
        viewport: {
          width: p.viewport?.width ?? 0,
          height: p.viewport?.height ?? 0,
          dpr: p.viewport?.dpr ?? 1,
        },
        status: (p.status as PageDTO['status']) ?? 'complete',
      }))
    } else {
      pages = await getLegacyPages(sessionId)
    }

    const response: ApiResponse<PageDTO[]> = {
      success: true,
      data: pages,
    }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// GET /api/sessions/:id/pages/:pageId/slices — range slice fetch for the timeline.
// Raw gaze `points` are omitted by default; pass ?includePoints=true for them.
pagesRouter.get(
  '/:id/pages/:pageId/slices',
  validateQuery(slicesQuerySchema),
  async (req, res, next) => {
    try {
      const sessionId = req.params.id ?? ''
      const pageId = req.params.pageId ?? ''
      const query = req.query as unknown as z.infer<typeof slicesQuerySchema>

      const session = await Session.findOne({ sessionId }).lean()
      if (!session) {
        res.status(404).json({ success: false, error: 'Session not found' })
        return
      }

      if (session.schemaVersion !== 2) {
        const legacy = await getLegacySlices(sessionId, pageId)
        res.setHeader('X-Total-Count', String(legacy.length))
        const response: ApiResponse<SliceListItem[]> = {
          success: true,
          data: legacy,
        }
        res.json(response)
        return
      }

      const filter: Record<string, unknown> = { sessionId, pageId }
      if (query.from !== undefined || query.to !== undefined) {
        const range: Record<string, number> = {}
        if (query.from !== undefined) range.$gte = query.from
        if (query.to !== undefined) range.$lte = query.to
        filter.sliceIndex = range
      }

      const projection: Record<string, number> = {
        sliceIndex: 1,
        capturedAt: 1,
        trigger: 1,
        screenshot: 1,
        fixations: 1,
      }
      if (query.includePoints) projection.gazePoints = 1

      const [docs, total] = await Promise.all([
        Slice.find(filter).sort({ sliceIndex: 1 }).select(projection).lean(),
        Slice.countDocuments({ sessionId, pageId }),
      ])

      const slices = docs.map((s) => {
        const item: SliceListItem & { gazePoints?: SliceDTO['gazePoints'] } = {
          _id: String(s._id),
          sessionId,
          pageId,
          sliceIndex: s.sliceIndex ?? 0,
          capturedAt: s.capturedAt ? new Date(s.capturedAt).toISOString() : '',
          trigger: (s.trigger as SliceListItem['trigger']) ?? 'interval',
          screenshot: {
            url: filePathToUrl(s.screenshot?.filePath) ?? '',
            scrollX: s.screenshot?.scrollX ?? 0,
            scrollY: s.screenshot?.scrollY ?? 0,
            viewportWidth: s.screenshot?.viewportWidth ?? 0,
            viewportHeight: s.screenshot?.viewportHeight ?? 0,
          },
          // Strip the internal `el` enrichment from stored fixations.
          fixations: s.fixations
            ? s.fixations.map((f) => ({
                x: f.x ?? 0,
                y: f.y ?? 0,
                startTs: f.startTs ? new Date(f.startTs).toISOString() : '',
                durationMs: f.durationMs ?? 0,
              }))
            : null,
        }
        if (query.includePoints && s.gazePoints) {
          item.gazePoints = s.gazePoints.map((p) => ({
            ts: p.ts ? new Date(p.ts).toISOString() : '',
            x: p.x ?? 0,
            y: p.y ?? 0,
            conf: p.conf ?? 0,
            el: p.el?.sel
              ? {
                  sel: p.el.sel,
                  tag: p.el.tag ?? '',
                  txt: p.el.txt ?? '',
                  rect: {
                    x: p.el.rect?.x ?? 0,
                    y: p.el.rect?.y ?? 0,
                    w: p.el.rect?.w ?? 0,
                    h: p.el.rect?.h ?? 0,
                  },
                }
              : null,
          }))
        }
        return item
      })

      res.setHeader('X-Total-Count', String(total))
      const response: ApiResponse<typeof slices> = {
        success: true,
        data: slices,
      }
      res.json(response)
    } catch (err) {
      next(err)
    }
  }
)
