import type { Request, Response, NextFunction } from 'express'

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('Unhandled error:', err.message)

  if (err.name === 'ValidationError') {
    res.status(400).json({
      success: false,
      error: err.message,
    })
    return
  }

  if (err.name === 'CastError') {
    res.status(400).json({
      success: false,
      error: 'Invalid parameter format',
    })
    return
  }

  const statusCode = 'statusCode' in err
    ? (err as Error & { statusCode: number }).statusCode
    : 500

  res.status(statusCode).json({
    success: false,
    error: statusCode === 500 ? 'Internal server error' : err.message,
  })
}
