import { useEffect, useRef, useCallback } from 'react'
import type { HeatmapData } from '@gazekit/shared'

interface HeatmapCanvasProps {
  data: HeatmapData | null
  opacity: number
  blurRadius: number
  showFixations: boolean
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
  opacity,
  blurRadius,
  showFixations,
}: HeatmapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const paint = useCallback(() => {
    if (!canvasRef.current || !containerRef.current || !data) return

    const container = containerRef.current
    const canvas = canvasRef.current
    const width = container.clientWidth
    const height = container.clientHeight
    if (width === 0 || height === 0) return

    canvas.width = width
    canvas.height = height

    const scaleX = width / data.viewportWidth
    const scaleY = height / data.viewportHeight

    const points = data.points
      .filter((p) => (showFixations ? p.value > 1 : true))
      .map((p) => ({
        x: Math.round(p.nx * data.viewportWidth * scaleX),
        y: Math.round(p.ny * data.viewportHeight * scaleY),
        value: p.value,
      }))

    const maxVal = points.reduce((max, p) => Math.max(max, p.value), 1)
    renderHeatmap(canvas, points, maxVal, blurRadius, opacity)
  }, [data, opacity, blurRadius, showFixations])

  useEffect(() => {
    paint()
  }, [paint])

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(() => paint())
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [paint])

  const screenshotUrl = data?.screenshotUrl

  return (
    <div className="card p-0 overflow-hidden">
      <div
        ref={containerRef}
        className="relative w-full bg-surface-800"
        style={{ aspectRatio: data ? `${data.viewportWidth} / ${data.viewportHeight}` : '16 / 9' }}
      >
        {screenshotUrl && (
          <img
            src={screenshotUrl}
            alt="Page screenshot"
            className="absolute inset-0 w-full h-full object-contain"
          />
        )}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
        />
        {!data && (
          <div className="absolute inset-0 flex items-center justify-center text-surface-500 text-sm">
            No heatmap data available
          </div>
        )}
      </div>
      {data && (
        <div className="px-4 py-2 bg-surface-800/50 border-t border-surface-700 flex items-center gap-4 text-xs text-surface-400">
          <span>Viewport: {data.viewportWidth} x {data.viewportHeight}</span>
          <span>Points: {data.points.length}</span>
          <span>Fixations: {data.totalFixations}</span>
        </div>
      )}
    </div>
  )
}
