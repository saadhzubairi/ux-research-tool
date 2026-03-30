import { Router } from 'express'
import { z } from 'zod'
import type { ApiResponse, HeatmapData } from '@gazekit/shared'
import { getSessionHeatmap, getAggregateHeatmap } from '../services/heatmapService'
import { Session } from '../models/Session'
import { validateQuery } from '../middleware/validation'

export const heatmapRouter = Router()

const sessionHeatmapQuerySchema = z.object({
  url: z.string().min(1, 'url is required'),
  from: z.coerce.number().optional(),
  to: z.coerce.number().optional(),
})

const aggregateHeatmapQuerySchema = z.object({
  url: z.string().min(1, 'url is required'),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
})

// GET /api/heatmap/aggregate?url=&from=&to= — aggregate heatmap across sessions
// Must be defined before /:id to avoid route conflict
heatmapRouter.get(
  '/aggregate',
  validateQuery(aggregateHeatmapQuerySchema),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as z.infer<typeof aggregateHeatmapQuerySchema>
      const heatmapData = await getAggregateHeatmap(
        query.url,
        query.from,
        query.to
      )

      const response: ApiResponse<HeatmapData> = {
        success: true,
        data: heatmapData,
      }

      res.json(response)
    } catch (err) {
      next(err)
    }
  }
)

// GET /api/sessions/:id/heatmap?url= — session-specific heatmap
// Note: This is mounted under /api/sessions in index.ts via sessionsRouter,
// but also available at /api/heatmap/:id for convenience
heatmapRouter.get(
  '/:id',
  validateQuery(sessionHeatmapQuerySchema),
  async (req, res, next) => {
    try {
      const sessionId = req.params.id ?? ''
      const query = req.query as unknown as z.infer<typeof sessionHeatmapQuerySchema>

      const session = await Session.findOne({ sessionId }).lean()
      if (!session) {
        res.status(404).json({
          success: false,
          error: 'Session not found',
        })
        return
      }

      const heatmapData = await getSessionHeatmap(
        sessionId,
        query.url,
        query.from,
        query.to,
      )

      const response: ApiResponse<HeatmapData> = {
        success: true,
        data: heatmapData,
      }

      res.json(response)
    } catch (err) {
      next(err)
    }
  }
)
