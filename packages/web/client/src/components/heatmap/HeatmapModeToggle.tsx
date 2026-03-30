export type HeatmapMode = 'timeline' | 'final'

interface HeatmapModeToggleProps {
  mode: HeatmapMode
  onModeChange: (mode: HeatmapMode) => void
}

export default function HeatmapModeToggle({
  mode,
  onModeChange,
}: HeatmapModeToggleProps) {
  return (
    <div className="flex items-center gap-4 mb-4">
      <div className="inline-flex rounded-md overflow-hidden border border-surface-600">
        <button
          onClick={() => onModeChange('timeline')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
            mode === 'timeline'
              ? 'bg-accent-600 text-white'
              : 'bg-surface-800 text-surface-400 hover:text-surface-200'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Timeline
        </button>
        <button
          onClick={() => onModeChange('final')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
            mode === 'final'
              ? 'bg-accent-600 text-white'
              : 'bg-surface-800 text-surface-400 hover:text-surface-200'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
          </svg>
          Final Map
        </button>
      </div>
      <span className="text-xs text-surface-500">
        {mode === 'timeline'
          ? 'Scrub through the session to see gaze data build up over time'
          : 'Complete heatmap overlayed on the final page screenshot'}
      </span>
    </div>
  )
}
