import React, { useEffect, useRef, useState } from 'react'
import type { ExtensionStatus } from '../../types/extension'
import { sendToServiceWorker } from '../hooks/useExtensionStatus'
import { usePopupStore } from '../store/popupStore'

interface TrackingViewProps {
  status: ExtensionStatus
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

function truncateUrl(url: string, maxLen: number = 40): string {
  if (!url || url.length <= maxLen) return url || ''
  return url.slice(0, maxLen) + '...'
}

export function TrackingView({ status }: TrackingViewProps) {
  const { trackingStartedAt, setTrackingStartedAt } = usePopupStore()
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!trackingStartedAt) {
      setTrackingStartedAt(Date.now())
    }
  }, [trackingStartedAt, setTrackingStartedAt])

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      if (trackingStartedAt) {
        setElapsed(Math.floor((Date.now() - trackingStartedAt) / 1000))
      }
    }, 1000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [trackingStartedAt])

  const handlePause = async () => {
    await sendToServiceWorker({ type: 'pause_tracking' })
  }

  const handleStop = async () => {
    await sendToServiceWorker({ type: 'stop_session' })
    setTrackingStartedAt(null)
  }

  const displayUrl = status.activeTabUrl
    ? truncateUrl(status.activeTabUrl)
    : status.activeTabId
      ? `Tab #${status.activeTabId}`
      : 'Unknown page'

  const wsColor =
    status.wsStatus === 'connected' ? 'bg-green-500' :
    status.wsStatus === 'reconnecting' ? 'bg-yellow-500' :
    'bg-red-500'

  const wsLabel =
    status.wsStatus === 'connected' ? 'Server Connected' :
    status.wsStatus === 'reconnecting' ? 'Reconnecting...' :
    'Server Disconnected'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
        </span>
        <span className="text-sm font-semibold text-red-600">Recording</span>
        <span className="ml-auto font-mono text-sm text-gray-700">
          {formatElapsed(elapsed)}
        </span>
      </div>

      <div className="rounded-lg bg-gray-50 px-3 py-2">
        <p className="truncate text-xs text-gray-500" title={status.activeTabUrl ?? ''}>
          {displayUrl}
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
        <span className={`inline-block h-2 w-2 rounded-full ${wsColor}`} />
        <span className="text-xs text-gray-600">{wsLabel}</span>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handlePause}
          className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100"
        >
          Pause
        </button>
        <button
          onClick={handleStop}
          className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-500 active:bg-red-700"
        >
          Stop
        </button>
      </div>
    </div>
  )
}
