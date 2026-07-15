import { useAppStore } from '../../store/appStore'
import { useServerStatus } from '../../api/hooks'
import StatusIndicator from '../common/StatusIndicator'

export default function TopBar() {
  const { sidebarOpen, toggleSidebar, activeSessionId } = useAppStore()
  const { data: statusResponse } = useServerStatus()
  const status = statusResponse?.data

  const isConnected = statusResponse?.success === true
  const mongoOk = status?.mongo?.connected === true

  const overallStatus: 'connected' | 'degraded' | 'disconnected' = !isConnected
    ? 'disconnected'
    : mongoOk
      ? 'connected'
      : 'degraded'

  return (
    <header className="h-16 flex items-center justify-between px-4 pr-6">
      <div className="flex items-center gap-3">
        <button
          onClick={toggleSidebar}
          className="btn-ghost p-2"
          aria-label="Toggle sidebar"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            {sidebarOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            )}
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-4">
        {activeSessionId && (
          <div className="flex items-center gap-2 px-3 py-1 bg-emerald-100 border-2 border-emerald-200 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-emerald-700 font-bold">
              Tracking Active
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 text-sm bg-surface-900 border-2 border-accent-100 rounded-full px-3.5 py-1.5 shadow-sticker">
          <StatusIndicator status={overallStatus} />
          <span className="text-surface-300 font-bold">
            {overallStatus === 'connected'
              ? 'Server connected'
              : overallStatus === 'degraded'
                ? 'Partial connection'
                : 'Server offline'}
          </span>
          {(status?.websocket?.activeConnections ?? 0) > 0 && (
            <span className="text-xs text-surface-500">
              ({status?.websocket?.activeConnections} active)
            </span>
          )}
        </div>
      </div>
    </header>
  )
}
