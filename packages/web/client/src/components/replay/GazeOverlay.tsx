import { useRef, useEffect } from 'react'

interface GazePoint {
  x: number
  y: number
  ts: number
}

interface GazeOverlayProps {
  points: GazePoint[]
  currentTime: number
  width: number
  height: number
  visible: boolean
  showFixations: boolean
}

const TRAIL_LENGTH = 10
const DOT_RADIUS = 20
const TRAIL_DECAY = 0.08

export default function GazeOverlay({
  points,
  currentTime,
  width,
  height,
  visible,
  showFixations,
}: GazeOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current || !visible) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = width
    canvas.height = height

    ctx.clearRect(0, 0, width, height)

    const currentIdx = points.findIndex((p) => p.ts >= currentTime)
    if (currentIdx === -1 && points.length === 0) return

    const effectiveIdx = currentIdx === -1 ? points.length - 1 : currentIdx
    const trailStart = Math.max(0, effectiveIdx - TRAIL_LENGTH)
    const trailPoints = points.slice(trailStart, effectiveIdx + 1)

    // Draw trail
    for (let i = 0; i < trailPoints.length - 1; i++) {
      const point = trailPoints[i]
      if (!point) continue
      const alpha = TRAIL_DECAY + (1 - TRAIL_DECAY) * (i / trailPoints.length)
      const radius = DOT_RADIUS * 0.3 * alpha

      ctx.beginPath()
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(239, 68, 68, ${alpha * 0.4})`
      ctx.fill()

      // Connect trail dots with line
      if (i > 0) {
        const prev = trailPoints[i - 1]
        if (prev) {
          ctx.beginPath()
          ctx.moveTo(prev.x, prev.y)
          ctx.lineTo(point.x, point.y)
          ctx.strokeStyle = `rgba(239, 68, 68, ${alpha * 0.2})`
          ctx.lineWidth = 1
          ctx.stroke()
        }
      }
    }

    // Draw current gaze point
    const currentPoint = trailPoints[trailPoints.length - 1]
    if (currentPoint) {
      // Outer glow
      const gradient = ctx.createRadialGradient(
        currentPoint.x, currentPoint.y, 0,
        currentPoint.x, currentPoint.y, DOT_RADIUS,
      )
      gradient.addColorStop(0, 'rgba(239, 68, 68, 0.6)')
      gradient.addColorStop(0.5, 'rgba(239, 68, 68, 0.2)')
      gradient.addColorStop(1, 'rgba(239, 68, 68, 0)')

      ctx.beginPath()
      ctx.arc(currentPoint.x, currentPoint.y, DOT_RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = gradient
      ctx.fill()

      // Inner dot
      ctx.beginPath()
      ctx.arc(currentPoint.x, currentPoint.y, 4, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(239, 68, 68, 0.9)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'
      ctx.lineWidth = 1
      ctx.stroke()
    }

    // Draw fixation circles
    if (showFixations) {
      const fixationThresholdMs = 150
      let fixStart = 0
      let fixX = 0
      let fixY = 0
      let fixCount = 0

      for (let i = 0; i < points.length; i++) {
        const p = points[i]
        if (!p || p.ts > currentTime) break

        if (fixCount === 0) {
          fixStart = p.ts
          fixX = p.x
          fixY = p.y
          fixCount = 1
          continue
        }

        const prevPoint = points[i - 1]
        if (!prevPoint) continue

        const dist = Math.sqrt(
          (p.x - fixX / fixCount) ** 2 + (p.y - fixY / fixCount) ** 2,
        )

        if (dist < 50) {
          fixX += p.x
          fixY += p.y
          fixCount++
        } else {
          const duration = (prevPoint.ts) - fixStart
          if (duration >= fixationThresholdMs) {
            const cx = fixX / fixCount
            const cy = fixY / fixCount
            const radius = Math.min(30, 8 + duration / 50)

            ctx.beginPath()
            ctx.arc(cx, cy, radius, 0, Math.PI * 2)
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.5)'
            ctx.lineWidth = 2
            ctx.stroke()
          }

          fixStart = p.ts
          fixX = p.x
          fixY = p.y
          fixCount = 1
        }
      }
    }
  }, [points, currentTime, width, height, visible, showFixations])

  if (!visible) return null

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-10"
      style={{ width, height }}
    />
  )
}
