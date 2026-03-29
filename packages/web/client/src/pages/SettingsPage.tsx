import { useState, useCallback } from 'react'
import { useServerStatus, useSessionsQuery, useDeleteAllSessions } from '../api/hooks'
import { formatDuration, formatNumber } from '../utils/formatters'
import StatusIndicator from '../components/common/StatusIndicator'
import ConfirmDialog from '../components/common/ConfirmDialog'
import api from '../api/client'

export default function SettingsPage() {
  const { data: statusResponse } = useServerStatus()
  const { data: sessionsResponse } = useSessionsQuery()
  const deleteAll = useDeleteAllSessions()

  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false)
  const [exportingId, setExportingId] = useState<string | null>(null)

  const status = statusResponse?.data
  const isConnected = statusResponse?.success === true
  const sessions = sessionsResponse?.data?.sessions ?? []

  const handleDeleteAll = useCallback(() => {
    deleteAll.mutate(undefined, {
      onSuccess: () => setShowDeleteAllConfirm(false),
    })
  }, [deleteAll])

  const handleExportSession = useCallback(async (sessionId: string) => {
    setExportingId(sessionId)
    try {
      const response = await api.get(`/api/sessions/${sessionId}`)
      const blob = new Blob([JSON.stringify(response.data, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `gazekit-session-${sessionId}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      setExportingId(null)
    }
  }, [])

  const handleExportHeatmapPng = useCallback(() => {
    const heatmapCanvas = document.querySelector<HTMLCanvasElement>(
      'canvas.heatmap-canvas, .heatmap-canvas canvas',
    )
    if (!heatmapCanvas) {
      const canvases = document.querySelectorAll('canvas')
      if (canvases.length === 0) {
        console.warn('No heatmap canvas found to export')
        return
      }
      const canvas = canvases[0]
      if (!canvas) return
      exportCanvasAsPng(canvas)
      return
    }
    exportCanvasAsPng(heatmapCanvas)
  }, [])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-surface-100">Settings</h1>
        <p className="text-sm text-surface-400 mt-1">
          Server status and data management
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="card-header">Server Status</h3>
          <div className="mt-3 space-y-3">
            <StatusRow
              label="Server"
              connected={isConnected}
            />
            <StatusRow
              label="MongoDB"
              connected={status?.mongo?.connected === true}
            />
            <StatusRow
              label="WebSocket"
              connected={(status?.websocket?.activeConnections ?? 0) > 0}
            />

            <div className="border-t border-surface-700 pt-3 mt-3 space-y-2">
              <DetailRow
                label="Active Connections"
                value={status?.websocket?.activeConnections !== undefined ? String(status.websocket.activeConnections) : '--'}
              />
              <DetailRow
                label="Uptime"
                value={status?.uptime?.formatted ?? '--'}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <h3 className="card-header">Data Management</h3>
          <div className="mt-3 space-y-3">
            <DetailRow
              label="Total Sessions"
              value={formatNumber(sessions.length)}
            />
            <DetailRow
              label="Server Sessions"
              value={status?.status === 'healthy' ? 'Connected' : '--'}
            />

            <div className="border-t border-surface-700 pt-3 mt-3">
              <button
                onClick={() => setShowDeleteAllConfirm(true)}
                className="btn-danger w-full"
                disabled={sessions.length === 0}
              >
                Delete All Sessions
              </button>
            </div>
          </div>
        </div>

        <div className="card lg:col-span-2">
          <h3 className="card-header">Export</h3>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-medium text-surface-200 mb-2">Export Session as JSON</h4>
              <p className="text-xs text-surface-400 mb-3">
                Download session data including metadata, gaze points, and calibration info.
              </p>
              {sessions.length === 0 ? (
                <p className="text-xs text-surface-500">No sessions available</p>
              ) : (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {sessions.slice(0, 20).map((session) => {
                    let displayUrl = '--'
                    if (session.pages.length > 0 && session.pages[0]) {
                      try {
                        displayUrl = new URL(session.pages[0].url).hostname
                      } catch {
                        displayUrl = session.pages[0].url
                      }
                    }

                    return (
                      <div
                        key={session.sessionId}
                        className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-surface-800"
                      >
                        <div className="text-xs text-surface-300 font-mono truncate flex-1 mr-2">
                          {displayUrl}
                        </div>
                        <button
                          onClick={() => handleExportSession(session.sessionId)}
                          disabled={exportingId === session.sessionId}
                          className="btn-ghost text-xs px-2 py-1"
                        >
                          {exportingId === session.sessionId ? 'Exporting...' : 'Export JSON'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div>
              <h4 className="text-sm font-medium text-surface-200 mb-2">Export Heatmap as PNG</h4>
              <p className="text-xs text-surface-400 mb-3">
                Export the currently visible heatmap as a PNG image. Navigate to a heatmap view first.
              </p>
              <button
                onClick={handleExportHeatmapPng}
                className="btn-secondary"
              >
                Export Heatmap PNG
              </button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteAllConfirm}
        title="Delete All Sessions"
        message={`Are you sure you want to delete all ${sessions.length} sessions? This will permanently remove all gaze tracking data, heatmaps, and replays. This action cannot be undone.`}
        confirmLabel="Delete All"
        onConfirm={handleDeleteAll}
        onCancel={() => setShowDeleteAllConfirm(false)}
      />
    </div>
  )
}

function StatusRow({ label, connected }: { label: string; connected: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-surface-300">{label}</span>
      <div className="flex items-center gap-2">
        <StatusIndicator status={connected ? 'connected' : 'disconnected'} />
        <span className={`text-xs ${connected ? 'text-green-400' : 'text-red-400'}`}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-surface-400">{label}</span>
      <span className="text-sm text-surface-200 font-mono tabular-nums">{value}</span>
    </div>
  )
}

function exportCanvasAsPng(canvas: HTMLCanvasElement) {
  const link = document.createElement('a')
  link.download = `gazekit-heatmap-${Date.now()}.png`
  link.href = canvas.toDataURL('image/png')
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
