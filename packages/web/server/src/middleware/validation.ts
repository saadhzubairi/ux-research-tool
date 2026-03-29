import type { Request, Response, NextFunction } from 'express'
import { ZodSchema, ZodError } from 'zod'

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse(req.query)
      req.query = parsed as Record<string, string>
      next()
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
        })
        return
      }
      next(err)
    }
  }
}

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body)
      next()
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
        })
        return
      }
      next(err)
    }
  }
}
