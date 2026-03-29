import React from 'react'
import type { ExtensionStatus } from '../../types/extension'
import { sendToServiceWorker } from '../hooks/useExtensionStatus'
import { usePopupStore } from '../store/popupStore'

interface PausedViewProps {
  status: ExtensionStatus
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

export function PausedView({ status: _status }: PausedViewProps) {
  const { trackingStartedAt, setTrackingStartedAt } = usePopupStore()

  const elapsed = trackingStartedAt
    ? Math.floor((Date.now() - trackingStartedAt) / 1000)
    : 0

  const handleResume = async () => {
    await sendToServiceWorker({ type: 'resume_tracking' })
  }

  const handleStop = async () => {
    await sendToServiceWorker({ type: 'stop_session' })
    setTrackingStartedAt(null)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-3 w-3 rounded-full bg-yellow-500" />
        <span className="text-sm font-semibold text-yellow-600">Paused</span>
      </div>

      <div className="rounded-lg bg-gray-50 px-3 py-3">
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center">
            <p className="font-mono text-lg font-bold text-gray-800">
              {formatElapsed(elapsed)}
            </p>
            <p className="text-xs text-gray-400">Elapsed</p>
          </div>
          <div className="text-center">
            <p className="font-mono text-lg font-bold text-gray-800">--</p>
            <p className="text-xs text-gray-400">Total Samples</p>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleResume}
          className="flex-1 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-500 active:bg-green-700"
        >
          Resume
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
