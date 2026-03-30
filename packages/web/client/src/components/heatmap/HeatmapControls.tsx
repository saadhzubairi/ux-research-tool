interface HeatmapControlsProps {
  urls?: string[]
  selectedUrl?: string
  onUrlChange?: (url: string) => void
  opacity: number
  onOpacityChange: (value: number) => void
  blurRadius: number
  onBlurRadiusChange: (value: number) => void
  showFixations: boolean
  onToggleFixations: () => void
}

export default function HeatmapControls({
  urls,
  selectedUrl,
  onUrlChange,
  opacity,
  onOpacityChange,
  blurRadius,
  onBlurRadiusChange,
  showFixations,
  onToggleFixations,
}: HeatmapControlsProps) {
  return (
    <div className="card space-y-4">
      <h3 className="card-header">Heatmap Controls</h3>

      {urls && urls.length > 1 && selectedUrl && onUrlChange && (
        <div>
          <label className="block text-xs text-surface-400 mb-1">Page URL</label>
          <select
            value={selectedUrl}
            onChange={(e) => onUrlChange(e.target.value)}
            className="select"
          >
            {urls.map((url) => {
              let display = url
              try {
                const parsed = new URL(url)
                display = parsed.hostname + parsed.pathname
              } catch {
                // use raw url
              }
              return (
                <option key={url} value={url}>
                  {display}
                </option>
              )
            })}
          </select>
        </div>
      )}

      <div>
        <label className="block text-xs text-surface-400 mb-1">
          Opacity: {opacity}%
        </label>
        <input
          type="range"
          min={0}
          max={100}
          value={opacity}
          onChange={(e) => onOpacityChange(Number(e.target.value))}
          className="w-full accent-accent-500"
        />
      </div>

      <div>
        <label className="block text-xs text-surface-400 mb-1">
          Blur Radius: {blurRadius}px
        </label>
        <input
          type="range"
          min={5}
          max={100}
          value={blurRadius}
          onChange={(e) => onBlurRadiusChange(Number(e.target.value))}
          className="w-full accent-accent-500"
        />
      </div>

      <div className="flex items-center justify-between">
        <label className="text-xs text-surface-400">Show Fixations Only</label>
        <button
          onClick={onToggleFixations}
          className={`relative w-10 h-5 transition-colors ${
            showFixations ? 'bg-accent-600' : 'bg-surface-600'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white transition-transform ${
              showFixations ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </div>
  )
}
