import { useRef, useEffect, useMemo } from 'react'
import type { SliceListItem, SliceFixation } from '@gazekit/shared'

interface SliceGazeTrailProps {
  slices: SliceListItem[]
  currentSlice: number
  viewportWidth: number
  viewportHeight: number
  /** How many trailing slices' fixations to render (default 4). */
  trailSlices?: number
  /** Draw dwell-scaled fixation circles in addition to the gaze trail. */
  showFixations?: boolean
}

const DOT_RADIUS = 20
const TRAIL_DECAY = 0.08

/**
 * Moment-by-moment gaze overlay for the slice-scrubbing view — the successor to
 * the old rrweb `GazeOverlay`. Renders the fixations from the last few slices as
 * a decaying trail over the current screenshot (normalized against the slice
 * viewport), with the most recent fixation as the bright "current gaze" dot.
 * Positioned absolutely to fill its parent (HeatmapCanvas's screenshot box).
 */
export default function SliceGazeTrail({
  slices,
  currentSlice,
  viewportWidth,
  viewportHeight,
  trailSlices = 4,
  showFixations = false,
}: SliceGazeTrailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Fixations from the trailing window of slices, oldest → newest.
  const trail = useMemo<SliceFixation[]>(() => {
    if (slices.length === 0) return []
    const end = Math.min(Math.max(0, currentSlice), slices.length - 1)
    const start = Math.max(0, end - (trailSlices - 1))
    const out: SliceFixation[] = []
    for (let i = start; i <= end; i++) {
      const fx = slices[i]?.fixations
      if (fx) out.push(...fx)
    }
    return out
  }, [slices, currentSlice, trailSlices])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return

    const draw = () => {
      const width = parent.clientWidth
      const height = parent.clientHeight
      if (width === 0 || height === 0) return
      canvas.width = width
      canvas.height = height

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, width, height)

      const vw = viewportWidth || 1
      const vh = viewportHeight || 1
      const toX = (x: number) => (x / vw) * width
      const toY = (y: number) => (y / vh) * height

      // Trail: connect fixations, fading in toward the newest.
      for (let i = 0; i < trail.length; i++) {
        const f = trail[i]!
        const alpha = TRAIL_DECAY + (1 - TRAIL_DECAY) * ((i + 1) / trail.length)
        const cx = toX(f.x)
        const cy = toY(f.y)

        if (i < trail.length - 1) {
          const radius = DOT_RADIUS * 0.3 * alpha
          ctx.beginPath()
          ctx.arc(cx, cy, radius, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(239, 68, 68, ${alpha * 0.4})`
          ctx.fill()
        }

        if (i > 0) {
          const prev = trail[i - 1]!
          ctx.beginPath()
          ctx.moveTo(toX(prev.x), toY(prev.y))
          ctx.lineTo(cx, cy)
          ctx.strokeStyle = `rgba(239, 68, 68, ${alpha * 0.2})`
          ctx.lineWidth = 1
          ctx.stroke()
        }
      }

      // Current gaze point (newest fixation) — bright dot with glow.
      const currentPoint = trail[trail.length - 1]
      if (currentPoint) {
        const cx = toX(currentPoint.x)
        const cy = toY(currentPoint.y)
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, DOT_RADIUS)
        gradient.addColorStop(0, 'rgba(239, 68, 68, 0.6)')
        gradient.addColorStop(0.5, 'rgba(239, 68, 68, 0.2)')
        gradient.addColorStop(1, 'rgba(239, 68, 68, 0)')
        ctx.beginPath()
        ctx.arc(cx, cy, DOT_RADIUS, 0, Math.PI * 2)
        ctx.fillStyle = gradient
        ctx.fill()

        ctx.beginPath()
        ctx.arc(cx, cy, 4, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(239, 68, 68, 0.9)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'
        ctx.lineWidth = 1
        ctx.stroke()
      }

      // Dwell-scaled fixation circles.
      if (showFixations) {
        for (const f of trail) {
          const radius = Math.min(30, 8 + f.durationMs / 50)
          ctx.beginPath()
          ctx.arc(toX(f.x), toY(f.y), radius, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(99, 102, 241, 0.5)'
          ctx.lineWidth = 2
          ctx.stroke()
        }
      }
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [trail, viewportWidth, viewportHeight, showFixations])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-10"
    />
  )
}
