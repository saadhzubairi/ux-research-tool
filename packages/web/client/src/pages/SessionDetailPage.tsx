import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  useSessionQuery,
  usePagesQuery,
  useSlicesQuery,
  useElementsQuery,
  useDeleteSession,
} from '../api/hooks'
import { useLiveSession } from '../api/useLiveSession'
import { formatDuration, formatDate, formatNumber } from '../utils/formatters'
import HeatmapCanvas from '../components/heatmap/HeatmapCanvas'
import HeatmapControls from '../components/heatmap/HeatmapControls'
import HeatmapUrlTabs from '../components/heatmap/HeatmapUrlTabs'
import SliceTimeline from '../components/timeline/SliceTimeline'
import SliceGazeTrail from '../components/timeline/SliceGazeTrail'
import ElementTable from '../components/elements/ElementTable'
import AttentionChart from '../components/elements/AttentionChart'
import ConfirmDialog from '../components/common/ConfirmDialog'
import EmptyState from '../components/common/EmptyState'

type Tab = 'overview' | 'heatmap' | 'elements'
type HeatmapView = 'heatmap' | 'moment'

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const sessionId = id ?? ''

  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [selectedPageId, setSelectedPageId] = useState('')
  const [currentSlice, setCurrentSlice] = useState(0)
  const [heatmapOpacity, setHeatmapOpacity] = useState(70)
  const [heatmapBlur, setHeatmapBlur] = useState(50)
  const [showFixations, setShowFixations] = useState(false)
  const [heatmapView, setHeatmapView] = useState<HeatmapView>('heatmap')

  const { data: sessionResponse, isLoading: sessionLoading } = useSessionQuery(sessionId)
  const { data: elementsResponse, isLoading: elementsLoading } = useElementsQuery(sessionId)
  const deleteSession = useDeleteSession()

  const session = sessionResponse?.data
  const elements = elementsResponse?.data ?? []

  // A session is "live" while status === 'active'. status is authoritative over
  // endedAt===null: a session that dies without a clean session_end is swept to
  // 'error' by the cleanup job while endedAt stays null (confirmed w/ backend).
  const isActive = session?.status === 'active'

  // Page tabs (real Page instances — repeat visits show as separate tabs).
  const { data: pagesResponse } = usePagesQuery(sessionId)
  const pages = useMemo(() => pagesResponse?.data ?? [], [pagesResponse])

  // Live subscription: only while the session is active. Appends slices into
  // the query cache and invalidates the pages query on navigation.
  useLiveSession(sessionId, isActive)

  // Default the selected page to the first tab once pages load.
  useEffect(() => {
    if (!selectedPageId && pages.length > 0) {
      setSelectedPageId(pages[0]!._id)
    }
  }, [pages, selectedPageId])

  // Slices for the selected page (base range so the live cache append is shared).
  const { data: slicesResponse } = useSlicesQuery(
    sessionId,
    selectedPageId || undefined,
  )
  const slices = useMemo(() => slicesResponse?.data ?? [], [slicesResponse])
  const maxSlice = slices.length - 1

  // Slice-position policy:
  // - active: always pin to the latest slice (growing heatmap).
  // - completed: default to the final slice once a page's slices first load,
  //   then respect manual scrubbing.
  const initedPageRef = useRef<string | null>(null)
  useEffect(() => {
    if (slices.length === 0) return
    if (isActive) {
      setCurrentSlice(slices.length - 1)
      return
    }
    if (initedPageRef.current !== selectedPageId) {
      initedPageRef.current = selectedPageId
      setCurrentSlice(slices.length - 1)
    }
  }, [slices.length, isActive, selectedPageId])

  const handlePageChange = useCallback((pageId: string) => {
    setSelectedPageId(pageId)
    initedPageRef.current = null
    setCurrentSlice(0)
  }, [])

  const clampedSlice = Math.min(Math.max(0, currentSlice), Math.max(0, maxSlice))
  const currentSliceObj = slices[clampedSlice]

  // Cumulative fixations across slices[0..currentSlice].
  const cumulativeFixations = useMemo(() => {
    const out = []
    for (let i = 0; i <= clampedSlice; i++) {
      const fx = slices[i]?.fixations
      if (fx) out.push(...fx)
    }
    return out
  }, [slices, clampedSlice])

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
    { key: 'elements', label: 'Elements' },
  ]

  const viewport = currentSliceObj?.screenshot
  const hasSlices = slices.length > 0

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/sessions')}
            className="btn-ghost p-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-surface-100 flex items-center gap-2">
              Session Detail
              {isActive && (
                <span className="flex items-center gap-1.5 text-xs font-bold text-pink-500 bg-pink-500/10 px-2.5 py-1 rounded-full">
                  <span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse" />
                  LIVE
                </span>
              )}
            </h1>
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

      <div className="mb-6">
        <div className="flex gap-2 bg-surface-900 border-2 border-accent-100 rounded-full p-1.5 w-fit shadow-sticker">
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

      {activeTab === 'overview' && <OverviewTab session={session} />}

      {activeTab === 'heatmap' && (
        <div>
          <HeatmapUrlTabs
            pages={pages}
            selectedPageId={selectedPageId}
            onPageChange={handlePageChange}
          />

          {/* Heatmap vs moment-by-moment (gaze trail) view toggle. */}
          <div className="mb-4 flex gap-2 bg-surface-900 border-2 border-accent-100 rounded-full p-1.5 w-fit shadow-sticker">
            {(['heatmap', 'moment'] as HeatmapView[]).map((v) => (
              <button
                key={v}
                onClick={() => setHeatmapView(v)}
                className={heatmapView === v ? 'tab-active' : 'tab'}
              >
                {v === 'heatmap' ? 'Heatmap' : 'Moment'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-3">
              {hasSlices && viewport ? (
                <>
                  <HeatmapCanvas
                    // Heatmap view: cumulative fixations. Moment view: no heat,
                    // just the screenshot + the gaze-trail overlay child.
                    fixations={heatmapView === 'heatmap' ? cumulativeFixations : []}
                    viewportWidth={viewport.viewportWidth}
                    viewportHeight={viewport.viewportHeight}
                    screenshotUrl={viewport.url}
                    opacity={heatmapOpacity}
                    blurRadius={heatmapBlur}
                    showFixations={showFixations}
                  >
                    {heatmapView === 'moment' && (
                      <SliceGazeTrail
                        slices={slices}
                        currentSlice={clampedSlice}
                        viewportWidth={viewport.viewportWidth}
                        viewportHeight={viewport.viewportHeight}
                        showFixations={showFixations}
                      />
                    )}
                  </HeatmapCanvas>
                  <SliceTimeline
                    slices={slices}
                    currentSlice={clampedSlice}
                    onCurrentSliceChange={setCurrentSlice}
                    live={isActive}
                  />
                </>
              ) : (
                <div className="card flex items-center justify-center py-20 text-sm text-surface-500">
                  {isActive
                    ? 'Waiting for the first slice to arrive…'
                    : 'No slices captured for this page.'}
                </div>
              )}
            </div>
            <div>
              <HeatmapControls
                opacity={heatmapOpacity}
                onOpacityChange={setHeatmapOpacity}
                blurRadius={heatmapBlur}
                onBlurRadiusChange={setHeatmapBlur}
                showFixations={showFixations}
                onToggleFixations={() => setShowFixations((v) => !v)}
              />
            </div>
          </div>
        </div>
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
        message="Are you sure you want to delete this session? All associated slices, heatmaps, and screenshots will be permanently removed."
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
                  stroke="#eef1fc"
                  strokeWidth="3"
                />
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke={qualityPct >= 80 ? '#34b877' : qualityPct >= 60 ? '#4a63c8' : qualityPct >= 40 ? '#f59e0b' : '#ef4444'}
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
                className="flex items-center justify-between py-2 px-3 rounded-2xl bg-accent-50"
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
