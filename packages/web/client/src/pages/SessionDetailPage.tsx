import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  useSessionQuery,
  useHeatmapQuery,
  useReplayQuery,
  useElementsQuery,
  useDeleteSession,
} from '../api/hooks'
import { formatDuration, formatDate, formatNumber } from '../utils/formatters'
import HeatmapCanvas from '../components/heatmap/HeatmapCanvas'
import HeatmapControls from '../components/heatmap/HeatmapControls'
import ReplayPlayer from '../components/replay/ReplayPlayer'
import ElementTable from '../components/elements/ElementTable'
import AttentionChart from '../components/elements/AttentionChart'
import ConfirmDialog from '../components/common/ConfirmDialog'
import EmptyState from '../components/common/EmptyState'

type Tab = 'overview' | 'heatmap' | 'replay' | 'elements'

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const sessionId = id ?? ''

  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [heatmapUrl, setHeatmapUrl] = useState('')
  const [heatmapOpacity, setHeatmapOpacity] = useState(70)
  const [heatmapBlur, setHeatmapBlur] = useState(50)
  const [showFixations, setShowFixations] = useState(false)

  const { data: sessionResponse, isLoading: sessionLoading } = useSessionQuery(sessionId)
  const { data: heatmapResponse } = useHeatmapQuery(sessionId, heatmapUrl || undefined)
  const { data: replayResponse, isLoading: replayLoading } = useReplayQuery(sessionId)
  const { data: elementsResponse, isLoading: elementsLoading } = useElementsQuery(sessionId)
  const deleteSession = useDeleteSession()

  const session = sessionResponse?.data
  const heatmapData = heatmapResponse?.data ?? null
  const replayData = replayResponse?.data ?? null
  const elements = elementsResponse?.data ?? []

  const pageUrls = session?.pages.map((p) => p.url) ?? []
  const uniqueUrls = [...new Set(pageUrls)]

  const handleDelete = useCallback(() => {
    deleteSession.mutate(sessionId, {
      onSuccess: () => navigate('/sessions'),
    })
  }, [deleteSession, sessionId, navigate])

  if (sessionLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!session) {
    return (
      <EmptyState
        title="Session not found"
        description="The requested session could not be found. It may have been deleted."
        action={{ label: 'Back to Sessions', onClick: () => navigate('/sessions') }}
      />
    )
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'heatmap', label: 'Heatmap' },
    { key: 'replay', label: 'Replay' },
    { key: 'elements', label: 'Elements' },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/sessions')}
            className="btn-ghost p-1.5 rounded-md"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-surface-100">Session Detail</h1>
            <p className="text-sm text-surface-400 font-mono mt-0.5">
              {sessionId}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="btn-danger"
        >
          Delete Session
        </button>
      </div>

      <div className="border-b border-surface-700 mb-6">
        <div className="flex gap-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={activeTab === tab.key ? 'tab-active' : 'tab'}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'overview' && (
        <OverviewTab session={session} />
      )}

      {activeTab === 'heatmap' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3">
            <HeatmapCanvas
              data={heatmapData}
              opacity={heatmapOpacity}
              blurRadius={heatmapBlur}
              showFixations={showFixations}
            />
          </div>
          <div>
            <HeatmapControls
              urls={uniqueUrls}
              selectedUrl={heatmapUrl || uniqueUrls[0] || ''}
              onUrlChange={setHeatmapUrl}
              opacity={heatmapOpacity}
              onOpacityChange={setHeatmapOpacity}
              blurRadius={heatmapBlur}
              onBlurRadiusChange={setHeatmapBlur}
              showFixations={showFixations}
              onToggleFixations={() => setShowFixations((v) => !v)}
            />
          </div>
        </div>
      )}

      {activeTab === 'replay' && (
        <ReplayPlayer data={replayData} isLoading={replayLoading} />
      )}

      {activeTab === 'elements' && (
        <div className="space-y-6">
          <ElementTable elements={elements} isLoading={elementsLoading} />
          <AttentionChart elements={elements} />
        </div>
      )}

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete Session"
        message="Are you sure you want to delete this session? All associated gaze data, heatmaps, and replays will be permanently removed."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}

function OverviewTab({ session }: { session: NonNullable<ReturnType<typeof useSessionQuery>['data']>['data'] }) {
  if (!session) return null

  const qualityPct = Math.round(session.calibration.qualityScore * 100)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Duration"
          value={session.durationMs !== null ? formatDuration(session.durationMs) : 'Active'}
        />
        <StatCard
          label="Total Gaze Points"
          value={formatNumber(session.stats.totalGazePoints)}
        />
        <StatCard
          label="Avg Confidence"
          value={`${(session.stats.avgConfidence * 100).toFixed(1)}%`}
        />
        <StatCard
          label="Tracking Loss"
          value={formatDuration(session.stats.trackingLossSeconds * 1000)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="card-header">Calibration Quality</h3>
          <div className="flex items-center gap-4 mt-2">
            <div className="relative w-20 h-20">
              <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="#334155"
                  strokeWidth="3"
                />
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke={qualityPct >= 80 ? '#22c55e' : qualityPct >= 60 ? '#6366f1' : qualityPct >= 40 ? '#f59e0b' : '#ef4444'}
                  strokeWidth="3"
                  strokeDasharray={`${qualityPct}, 100`}
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-surface-100">
                {qualityPct}%
              </span>
            </div>
            <div className="text-sm space-y-1">
              <p className="text-surface-300">
                Method: <span className="text-surface-100">{session.calibration.method}</span>
              </p>
              <p className="text-surface-300">
                Avg Error: <span className="text-surface-100">{session.calibration.avgErrorPx.toFixed(1)}px</span>
              </p>
              <p className="text-surface-300">
                Precision: <span className="text-surface-100">{session.calibration.precisionPx.toFixed(1)}px</span>
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 className="card-header">Device Info</h3>
          <div className="text-sm space-y-1.5 mt-2">
            <p className="text-surface-300">
              Screen: <span className="text-surface-100">{session.device.screenWidth} x {session.device.screenHeight}</span>
              <span className="text-surface-500 ml-1">@{session.device.dpr}x</span>
            </p>
            <p className="text-surface-300">
              Webcam: <span className="text-surface-100">{session.webcam.label}</span>
            </p>
            <p className="text-surface-300">
              Resolution: <span className="text-surface-100">{session.webcam.resolution.w} x {session.webcam.resolution.h}</span>
            </p>
            <p className="text-surface-300">
              Tracker: <span className="text-surface-100">{session.tracking.library} v{session.tracking.version}</span>
            </p>
            <p className="text-surface-300">
              Avg FPS: <span className="text-surface-100">{session.tracking.avgFps.toFixed(1)}</span>
            </p>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="card-header">Pages Visited</h3>
        <div className="mt-2 space-y-2">
          {session.pages.length === 0 ? (
            <p className="text-sm text-surface-500">No pages recorded</p>
          ) : (
            session.pages.map((page, i) => (
              <div
                key={`${page.url}-${i}`}
                className="flex items-center justify-between py-2 px-3 rounded-md bg-surface-800/50"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs text-surface-500 w-6 flex-shrink-0 tabular-nums">
                    {i + 1}.
                  </span>
                  <span className="text-sm text-surface-200 font-mono truncate">
                    {page.url}
                  </span>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0 ml-4">
                  <span className="text-xs text-surface-400">
                    {formatDate(page.enteredAt)}
                  </span>
                  {page.leftAt && (
                    <span className="text-xs text-surface-500">
                      {formatDuration(new Date(page.leftAt).getTime() - new Date(page.enteredAt).getTime())}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <p className="text-xs text-surface-400 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-surface-100 mt-1 tabular-nums">{value}</p>
    </div>
  )
}
