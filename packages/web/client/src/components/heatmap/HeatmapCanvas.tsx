import { useEffect, useRef, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { HeatmapData, SliceFixation } from '@gazekit/shared'

interface HeatmapCanvasProps {
  /** Aggregate/legacy source (HeatmapsPage aggregate + compare views). */
  data?: HeatmapData | null
  /**
   * Slice source (SessionDetailPage): cumulative fixations across
   * slices[0..currentSlice]. Normalized against viewportWidth/Height (taken
   * from the current slice's screenshot). Weighted by durationMs.
   */
  fixations?: SliceFixation[]
  viewportWidth?: number
  viewportHeight?: number
  screenshotUrl?: string | null
  opacity: number
  blurRadius: number
  showFixations: boolean
  screenshotUrlOverride?: string | null
  /** Overlay layer (e.g. gaze trail) positioned over the screenshot. */
  children?: ReactNode
}

interface ResolvedHeatmap {
  viewportWidth: number
  viewportHeight: number
  points: Array<{ nx: number; ny: number; value: number }>
  screenshotUrl: string | null
  totalFixations: number
  pointCount: number
}

function buildPalette(): Uint8Array {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 1
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, 256, 0)
  grad.addColorStop(0.1, '#1e40af')
  grad.addColorStop(0.3, '#3b82f6')
  grad.addColorStop(0.5, '#22c55e')
  grad.addColorStop(0.7, '#eab308')
  grad.addColorStop(0.9, '#ef4444')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 256, 1)
  return new Uint8Array(ctx.getImageData(0, 0, 256, 1).data.buffer)
}

let palette: Uint8Array | null = null
function getPalette() {
  if (!palette) palette = buildPalette()
  return palette
}

function renderHeatmap(
  canvas: HTMLCanvasElement,
  points: Array<{ x: number; y: number; value: number }>,
  maxValue: number,
  radius: number,
  opacity: number,
) {
  const width = canvas.width
  const height = canvas.height
  if (width === 0 || height === 0) return

  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.clearRect(0, 0, width, height)
  if (points.length === 0) return

  // 1 — draw intensity circles (alpha channel encodes heat)
  const buf = document.createElement('canvas')
  buf.width = width
  buf.height = height
  const bCtx = buf.getContext('2d')!

  for (const p of points) {
    const intensity = Math.min(p.value / maxValue, 1)
    const grad = bCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius)
    grad.addColorStop(0, `rgba(0,0,0,${intensity})`)
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    bCtx.fillStyle = grad
    bCtx.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2)
  }

  // 2 — colorize using palette lookup on alpha channel
  const img = bCtx.getImageData(0, 0, width, height)
  const px = img.data
  const pal = getPalette()

  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3]!
    if (a > 0) {
      const off = a * 4
      px[i] = pal[off]!
      px[i + 1] = pal[off + 1]!
      px[i + 2] = pal[off + 2]!
      px[i + 3] = Math.round(a * (opacity / 100))
    }
  }

  ctx.putImageData(img, 0, 0)
}

export default function HeatmapCanvas({
  data,
  fixations,
  viewportWidth,
  viewportHeight,
  screenshotUrl,
  opacity,
  blurRadius,
  showFixations,
  screenshotUrlOverride,
  children,
}: HeatmapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Normalize either source into one shape the renderer understands.
  const resolved: ResolvedHeatmap | null = useMemo(() => {
    if (fixations) {
      const vw = viewportWidth || 1
      const vh = viewportHeight || 1
      const points = fixations.map((f) => ({
        nx: f.x / vw,
        ny: f.y / vh,
        value: f.durationMs || 1,
      }))
      return {
        viewportWidth: vw,
        viewportHeight: vh,
        points,
        screenshotUrl: screenshotUrl ?? null,
        totalFixations: fixations.length,
        pointCount: points.length,
      }
    }
    if (data) {
      return {
        viewportWidth: data.viewportWidth,
        viewportHeight: data.viewportHeight,
        points: data.points,
        screenshotUrl: data.screenshotUrl,
        totalFixations: data.totalFixations,
        pointCount: data.points.length,
      }
    }
    return null
  }, [data, fixations, viewportWidth, viewportHeight, screenshotUrl])

  const paint = useCallback(() => {
    if (!canvasRef.current || !containerRef.current || !resolved) return

    const container = containerRef.current
    const canvas = canvasRef.current
    const width = container.clientWidth
    const height = container.clientHeight
    if (width === 0 || height === 0) return

    canvas.width = width
    canvas.height = height

    const scaleX = width / resolved.viewportWidth

    const points = resolved.points
      .filter((p) => (showFixations ? p.value > 1 : true))
      .map((p) => ({
        x: Math.round(p.nx * width),
        y: Math.round(p.ny * height),
        value: p.value,
      }))

    const maxVal = points.reduce((max, p) => Math.max(max, p.value), 1)
    // blurRadius is defined in viewport px — scale it with the points so the
    // apparent hotspot size doesn't change with the dashboard container size
    renderHeatmap(canvas, points, maxVal, blurRadius * scaleX, opacity)
  }, [resolved, opacity, blurRadius, showFixations])

  useEffect(() => {
    paint()
  }, [paint])

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(() => paint())
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [paint])

  const displayScreenshotUrl =
    screenshotUrlOverride !== undefined
      ? screenshotUrlOverride
      : resolved?.screenshotUrl ?? null

  return (
    <div className="card p-0 overflow-hidden">
      <div
        ref={containerRef}
        className="relative w-full bg-surface-800"
        style={{
          aspectRatio: resolved
            ? `${resolved.viewportWidth} / ${resolved.viewportHeight}`
            : '16 / 9',
        }}
      >
        {displayScreenshotUrl && (
          <img
            src={displayScreenshotUrl}
            alt="Page screenshot"
            className="absolute inset-0 w-full h-full object-contain"
          />
        )}
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        {children}
        {!resolved && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-surface-500">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
            </svg>
            <span className="text-sm">No heatmap data available</span>
          </div>
        )}
        {resolved && !displayScreenshotUrl && (
          <div className="absolute bottom-2 left-2 text-xs text-surface-600 bg-surface-900/60 px-2 py-1 rounded">
            No page screenshot available
          </div>
        )}
      </div>
      {resolved && (
        <div className="px-4 py-2 bg-surface-800/50 border-t border-surface-700 flex items-center gap-4 text-xs text-surface-400">
          <span>Viewport: {resolved.viewportWidth} x {resolved.viewportHeight}</span>
          <span>Points: {resolved.pointCount}</span>
          <span>Fixations: {resolved.totalFixations}</span>
        </div>
      )}
    </div>
  )
}
