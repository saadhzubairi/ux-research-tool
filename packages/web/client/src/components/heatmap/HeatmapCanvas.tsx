import { useEffect, useRef } from 'react'
import type { HeatmapData } from '@gazekit/shared'

interface HeatmapCanvasProps {
  data: HeatmapData | null
  opacity: number
  blurRadius: number
  showFixations: boolean
}

interface HeatmapInstance {
  setData: (data: { max: number; data: Array<{ x: number; y: number; value: number }> }) => void
  configure: (config: Record<string, unknown>) => void
  repaint: () => void
}

interface HeatmapFactory {
  create: (config: Record<string, unknown>) => HeatmapInstance
}

export default function HeatmapCanvas({
  data,
  opacity,
  blurRadius,
  showFixations,
}: HeatmapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const heatmapRef = useRef<HeatmapInstance | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    let cancelled = false

    async function initHeatmap() {
      try {
        const h337Module = await import('heatmap.js')
        const h337 = (h337Module.default ?? h337Module) as unknown as HeatmapFactory

        if (cancelled || !containerRef.current) return

        if (heatmapRef.current) return

        heatmapRef.current = h337.create({
          container: containerRef.current,
          radius: blurRadius,
          maxOpacity: opacity / 100,
          minOpacity: 0,
          blur: 0.85,
          gradient: {
            0.1: '#1e40af',
            0.3: '#3b82f6',
            0.5: '#22c55e',
            0.7: '#eab308',
            0.9: '#ef4444',
          },
        })
      } catch (err) {
        console.error('Failed to initialize heatmap.js:', err)
      }
    }

    initHeatmap()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!heatmapRef.current) return

    heatmapRef.current.configure({
      radius: blurRadius,
      maxOpacity: opacity / 100,
    })
    heatmapRef.current.repaint()
  }, [opacity, blurRadius])

  useEffect(() => {
    if (!heatmapRef.current || !data || !containerRef.current) return

    const container = containerRef.current
    const width = container.clientWidth
    const height = container.clientHeight

    if (width === 0 || height === 0) return

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

    heatmapRef.current.setData({
      max: maxVal,
      data: points,
    })
  }, [data, showFixations])

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
        {!data && (
          <div className="absolute inset-0 flex items-center justify-center text-surface-500 text-sm">
            No heatmap data available
          </div>
        )}
      </div>
      {data && (
        <div className="px-4 py-2 bg-surface-800/50 border-t border-surface-700 flex items-center gap-4 text-xs text-surface-400">
          <span>
            Viewport: {data.viewportWidth} x {data.viewportHeight}
          </span>
          <span>
            Points: {data.points.length}
          </span>
          <span>
            Fixations: {data.totalFixations}
          </span>
        </div>
      )}
    </div>
  )
}
