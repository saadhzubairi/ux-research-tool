import { Router } from 'express'
import { z } from 'zod'
import type { ApiResponse, HeatmapData } from '@gazekit/shared'
import {
  getSessionHeatmap,
  getAggregateHeatmap,
  getLegacySessionHeatmap,
} from '../services/heatmapService'
import { Session } from '../models/Session'
import { legacyPageUrl } from '../services/legacyRead'
import { validateQuery } from '../middleware/validation'

export const heatmapRouter = Router()

// v2: pageId-keyed. `to` is a slice-index cutoff for progressive/scrub reads.
// v1 fallback still accepts a url + numeric ts range.
const sessionHeatmapQuerySchema = z.object({
  pageId: z.string().optional(),
  url: z.string().optional(),
  from: z.coerce.number().optional(),
  to: z.coerce.number().optional(),
})

const aggregateHeatmapQuerySchema = z.object({
  url: z.string().min(1, 'url is required'),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
})

// GET /api/heatmap/aggregate?url=&from=&to= — aggregate across sessions.
// Must be defined before /:id to avoid a route conflict.
heatmapRouter.get(
  '/aggregate',
  validateQuery(aggregateHeatmapQuerySchema),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as z.infer<typeof aggregateHeatmapQuerySchema>
      const heatmapData = await getAggregateHeatmap(query.url, query.from, query.to)
      const response: ApiResponse<HeatmapData> = { success: true, data: heatmapData }
      res.json(response)
    } catch (err) {
      next(err)
    }
  }
)

// GET /api/heatmap/:id?pageId=&to= — session heatmap, keyed by Page.
heatmapRouter.get(
  '/:id',
  validateQuery(sessionHeatmapQuerySchema),
  async (req, res, next) => {
    try {
      const sessionId = req.params.id ?? ''
      const query = req.query as unknown as z.infer<typeof sessionHeatmapQuerySchema>

      const session = await Session.findOne({ sessionId }).lean()
      if (!session) {
        res.status(404).json({ success: false, error: 'Session not found' })
        return
      }

      let heatmapData: HeatmapData
      if (session.schemaVersion === 2) {
        if (!query.pageId) {
          res.status(400).json({ success: false, error: 'pageId is required' })
          return
        }
        heatmapData = await getSessionHeatmap(sessionId, query.pageId, query.to)
      } else {
        // Legacy v1: url-keyed. Accept either an explicit url or a synthetic
        // pageId (visit folder) to resolve one.
        let url = query.url
        if (!url && query.pageId) {
          url = (await legacyPageUrl(sessionId, query.pageId)) ?? undefined
        }
        if (!url) {
          res.status(400).json({ success: false, error: 'url or pageId is required' })
          return
        }
        heatmapData = await getLegacySessionHeatmap(sessionId, url, query.from, query.to)
      }

      const response: ApiResponse<HeatmapData> = { success: true, data: heatmapData }
      res.json(response)
    } catch (err) {
      next(err)
    }
  }
)
