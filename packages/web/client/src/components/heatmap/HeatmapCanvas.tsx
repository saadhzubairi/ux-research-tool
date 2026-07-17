import { useEffect, useRef, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { HeatmapData, SliceFixation } from '@gazekit/shared'

interface HeatmapCanvasProps {
  /** Aggregate/legacy source (HeatmapsPage aggregate + compare views). */
  data?: HeatmapData | null
  /**
   * Slice source (SessionDetailPage): cumulative fixations across
   * slices[0..currentSlice]. Normalized against viewportWidth/Height (taken
   * from the current slice's screenshot). Weighted by durationMs. Used only
   * when `showFixations` is on (fixations are sparse — see gazePoints).
   */
  fixations?: SliceFixation[]
  /**
   * Raw gaze points (viewport px) for the session-detail heatmap — the density
   * source that actually forms the map. Per-slice fixations are far too sparse
   * to render a heatmap, so raw gaze density is the default; fixations are the
   * opt-in "Show Fixations Only" overlay. Normalized against viewportWidth/Height.
   */
  gazePoints?: Array<{ x: number; y: number; value?: number }>
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

/**
 * Density-grid heatmap renderer. Accumulates a Gaussian splat per point into a
 * float grid (at reduced resolution for speed), normalizes against a
 * high-percentile density (so one dominant hotspot can't wash out the rest of
 * the map), then colorizes via the palette. This is self-normalizing: the
 * hottest areas always reach the top of the palette regardless of how many
 * points there are or how their weights are distributed.
 */
function renderHeatmap(
  canvas: HTMLCanvasElement,
  points: Array<{ x: number; y: number; value: number }>,
  radius: number,
  opacity: number,
) {
  const width = canvas.width
  const height = canvas.height
  if (width === 0 || height === 0) return

  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, width, height)
  if (points.length === 0) return

  // Work at reduced resolution — plenty for a blurred density field.
  const DOWNSCALE = 4
  const gw = Math.max(1, Math.ceil(width / DOWNSCALE))
  const gh = Math.max(1, Math.ceil(height / DOWNSCALE))
  const grid = new Float32Array(gw * gh)

  // Precompute a Gaussian kernel sized to the requested blur radius.
  const r = Math.max(2, Math.round(radius / DOWNSCALE))
  const sigma = r / 2
  const kSize = r * 2 + 1
  const kernel = new Float32Array(kSize * kSize)
  for (let ky = -r; ky <= r; ky++) {
    for (let kx = -r; kx <= r; kx++) {
      kernel[(ky + r) * kSize + (kx + r)] = Math.exp(
        -(kx * kx + ky * ky) / (2 * sigma * sigma),
      )
    }
  }

  // Stamp each point. sqrt() compresses the weight's dynamic range so a single
  // long fixation doesn't flatten everything else into invisibility.
  for (const p of points) {
    const cx = Math.round(p.x / DOWNSCALE)
    const cy = Math.round(p.y / DOWNSCALE)
    const w = Math.sqrt(Math.max(p.value, 1))
    for (let ky = -r; ky <= r; ky++) {
      const gy = cy + ky
      if (gy < 0 || gy >= gh) continue
      const rowOff = gy * gw
      const kOff = (ky + r) * kSize
      for (let kx = -r; kx <= r; kx++) {
        const gx = cx + kx
        if (gx < 0 || gx >= gw) continue
        grid[rowOff + gx]! += w * kernel[kOff + (kx + r)]!
      }
    }
  }

  // Normalize against the ~95th percentile of non-zero density: hotspots
  // saturate the palette top while mid-density regions stay clearly visible.
  const nonZero: number[] = []
  for (let i = 0; i < grid.length; i++) {
    if (grid[i]! > 0) nonZero.push(grid[i]!)
  }
  if (nonZero.length === 0) return
  nonZero.sort((a, b) => a - b)
  const norm = nonZero[Math.floor(nonZero.length * 0.95)]! || nonZero[nonZero.length - 1]!

  // Colorize the low-res grid, then upscale with smoothing.
  const buf = document.createElement('canvas')
  buf.width = gw
  buf.height = gh
  const bCtx = buf.getContext('2d')!
  const img = bCtx.createImageData(gw, gh)
  const px = img.data
  const pal = getPalette()
  const alphaScale = (opacity / 100) * 255

  for (let i = 0; i < grid.length; i++) {
    const t = Math.min(grid[i]! / norm, 1)
    if (t <= 0.02) continue
    const off = Math.min(255, Math.round(t * 255)) * 4
    const o = i * 4
    px[o] = pal[off]!
    px[o + 1] = pal[off + 1]!
    px[o + 2] = pal[off + 2]!
    // Alpha ramps in quickly so even light-density areas are clearly visible.
    px[o + 3] = Math.round(Math.min(1, 0.35 + t * 0.85) * alphaScale)
  }

  bCtx.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(buf, 0, 0, gw, gh, 0, 0, width, height)
}

export default function HeatmapCanvas({
  data,
  fixations,
  gazePoints,
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
    // Slice source (session detail): raw gaze density by default, precomputed
    // fixations when "Show Fixations Only" is on. Either array being provided
    // (even empty, e.g. the moment view) selects this over the aggregate `data`.
    if (gazePoints || fixations) {
      const vw = viewportWidth || 1
      const vh = viewportHeight || 1
      const useFixations = showFixations && !!fixations && fixations.length > 0
      const points = useFixations
        ? fixations!.map((f) => ({ nx: f.x / vw, ny: f.y / vh, value: f.durationMs || 1 }))
        : (gazePoints ?? []).map((p) => ({ nx: p.x / vw, ny: p.y / vh, value: p.value ?? 1 }))
      return {
        viewportWidth: vw,
        viewportHeight: vh,
        points,
        screenshotUrl: screenshotUrl ?? null,
        totalFixations: fixations?.length ?? 0,
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
  }, [data, fixations, gazePoints, viewportWidth, viewportHeight, screenshotUrl, showFixations])

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

    // Source selection (raw gaze vs fixations) already happened in `resolved`;
    // just project normalized points into canvas px.
    const points = resolved.points.map((p) => ({
      x: Math.round(p.nx * width),
      y: Math.round(p.ny * height),
      value: p.value,
    }))

    // blurRadius is defined in viewport px — scale it with the points so the
    // apparent hotspot size doesn't change with the dashboard container size
    renderHeatmap(canvas, points, blurRadius * scaleX, opacity)
  }, [resolved, opacity, blurRadius])

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
