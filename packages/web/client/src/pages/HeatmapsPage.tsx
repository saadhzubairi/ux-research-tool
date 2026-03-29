import { useState } from 'react'
import { useAggregateHeatmapQuery } from '../api/hooks'
import { formatNumber } from '../utils/formatters'
import HeatmapCanvas from '../components/heatmap/HeatmapCanvas'
import HeatmapControls from '../components/heatmap/HeatmapControls'
import DateRangePicker from '../components/common/DateRangePicker'
import EmptyState from '../components/common/EmptyState'

export default function HeatmapsPage() {
  const [url, setUrl] = useState('')
  const [submittedUrl, setSubmittedUrl] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [opacity, setOpacity] = useState(70)
  const [blurRadius, setBlurRadius] = useState(50)
  const [showFixations, setShowFixations] = useState(false)

  const [compareMode, setCompareMode] = useState(false)
  const [compareUrl, setCompareUrl] = useState('')
  const [submittedCompareUrl, setSubmittedCompareUrl] = useState('')
  const [compareFromDate, setCompareFromDate] = useState('')
  const [compareToDate, setCompareToDate] = useState('')

  const { data: heatmapResponse, isLoading } = useAggregateHeatmapQuery(
    submittedUrl,
    fromDate || undefined,
    toDate || undefined,
  )

  const { data: compareResponse, isLoading: compareLoading } = useAggregateHeatmapQuery(
    submittedCompareUrl,
    compareFromDate || undefined,
    compareToDate || undefined,
  )

  const heatmapData = heatmapResponse?.data ?? null
  const compareData = compareResponse?.data ?? null

  function handleAnalyze(e: React.FormEvent) {
    e.preventDefault()
    if (url.trim()) {
      setSubmittedUrl(url.trim())
    }
  }

  function handleCompareAnalyze(e: React.FormEvent) {
    e.preventDefault()
    if (compareUrl.trim()) {
      setSubmittedCompareUrl(compareUrl.trim())
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Heatmaps</h1>
          <p className="text-sm text-surface-400 mt-1">
            Aggregate eye tracking heatmaps across all sessions
          </p>
        </div>
        <button
          onClick={() => setCompareMode((v) => !v)}
          className={compareMode ? 'btn-primary' : 'btn-secondary'}
        >
          {compareMode ? 'Exit Comparison' : 'Compare'}
        </button>
      </div>

      <div className={compareMode ? 'grid grid-cols-1 xl:grid-cols-2 gap-6' : ''}>
        <div className="space-y-4">
          <form onSubmit={handleAnalyze} className="flex gap-3">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Enter URL to analyze (e.g., https://example.com/page)"
              className="input flex-1"
            />
            <button type="submit" className="btn-primary" disabled={!url.trim()}>
              Analyze
            </button>
          </form>

          <div className="flex items-center gap-4">
            <DateRangePicker
              from={fromDate}
              to={toDate}
              onFromChange={setFromDate}
              onToChange={setToDate}
            />
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!submittedUrl && !isLoading && (
            <EmptyState
              title="Enter a URL to analyze"
              description="Type in a page URL to view aggregate heatmap data across all sessions that visited that page."
              icon={
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
                </svg>
              }
            />
          )}

          {submittedUrl && !isLoading && heatmapData && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="card text-center">
                  <p className="text-xs text-surface-400 uppercase tracking-wider">Sessions</p>
                  <p className="text-xl font-bold text-surface-100 mt-1 tabular-nums">
                    {heatmapData.sessionCount}
                  </p>
                </div>
                <div className="card text-center">
                  <p className="text-xs text-surface-400 uppercase tracking-wider">Total Fixations</p>
                  <p className="text-xl font-bold text-surface-100 mt-1 tabular-nums">
                    {formatNumber(heatmapData.totalFixations)}
                  </p>
                </div>
                <div className="card text-center">
                  <p className="text-xs text-surface-400 uppercase tracking-wider">Data Points</p>
                  <p className="text-xl font-bold text-surface-100 mt-1 tabular-nums">
                    {formatNumber(heatmapData.points.length)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                <div className="lg:col-span-3">
                  <HeatmapCanvas
                    data={heatmapData}
                    opacity={opacity}
                    blurRadius={blurRadius}
                    showFixations={showFixations}
                  />
                </div>
                <div>
                  <HeatmapControls
                    urls={[submittedUrl]}
                    selectedUrl={submittedUrl}
                    onUrlChange={() => {}}
                    opacity={opacity}
                    onOpacityChange={setOpacity}
                    blurRadius={blurRadius}
                    onBlurRadiusChange={setBlurRadius}
                    showFixations={showFixations}
                    onToggleFixations={() => setShowFixations((v) => !v)}
                  />
                </div>
              </div>
            </div>
          )}

          {submittedUrl && !isLoading && !heatmapData && (
            <EmptyState
              title="No data for this URL"
              description="No eye tracking sessions have been recorded for this URL yet."
            />
          )}
        </div>

        {compareMode && (
          <div className="space-y-4">
            <form onSubmit={handleCompareAnalyze} className="flex gap-3">
              <input
                type="text"
                value={compareUrl}
                onChange={(e) => setCompareUrl(e.target.value)}
                placeholder="Compare URL..."
                className="input flex-1"
              />
              <button type="submit" className="btn-primary" disabled={!compareUrl.trim()}>
                Analyze
              </button>
            </form>

            <div className="flex items-center gap-4">
              <DateRangePicker
                from={compareFromDate}
                to={compareToDate}
                onFromChange={setCompareFromDate}
                onToChange={setCompareToDate}
              />
            </div>

            {compareLoading && (
              <div className="flex items-center justify-center py-20">
                <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {!submittedCompareUrl && !compareLoading && (
              <EmptyState
                title="Enter a URL to compare"
                description="Type in a second page URL for side-by-side heatmap comparison."
              />
            )}

            {submittedCompareUrl && !compareLoading && compareData && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="card text-center">
                    <p className="text-xs text-surface-400 uppercase tracking-wider">Sessions</p>
                    <p className="text-xl font-bold text-surface-100 mt-1 tabular-nums">
                      {compareData.sessionCount}
                    </p>
                  </div>
                  <div className="card text-center">
                    <p className="text-xs text-surface-400 uppercase tracking-wider">Total Fixations</p>
                    <p className="text-xl font-bold text-surface-100 mt-1 tabular-nums">
                      {formatNumber(compareData.totalFixations)}
                    </p>
                  </div>
                  <div className="card text-center">
                    <p className="text-xs text-surface-400 uppercase tracking-wider">Data Points</p>
                    <p className="text-xl font-bold text-surface-100 mt-1 tabular-nums">
                      {formatNumber(compareData.points.length)}
                    </p>
                  </div>
                </div>

                <HeatmapCanvas
                  data={compareData}
                  opacity={opacity}
                  blurRadius={blurRadius}
                  showFixations={showFixations}
                />
              </div>
            )}

            {submittedCompareUrl && !compareLoading && !compareData && (
              <EmptyState
                title="No data for this URL"
                description="No eye tracking sessions have been recorded for this URL."
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
