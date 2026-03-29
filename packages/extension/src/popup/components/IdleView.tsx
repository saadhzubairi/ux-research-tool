import React from 'react'
import type { ExtensionStatus } from '../../types/extension'
import { CalibrationBadge } from './CalibrationBadge'
import { sendToServiceWorker, useServerReachable } from '../hooks/useExtensionStatus'

interface IdleViewProps {
  status: ExtensionStatus
  onStartTracking: () => void
}

export function IdleView({ status, onStartTracking }: IdleViewProps) {
  const serverReachable = useServerReachable(status.settings.wsPort)
  const hasCalibration = status.lastCalibration !== null

  const handleCalibrate = async () => {
    await sendToServiceWorker({ type: 'open_calibration' })
  }

  const handleOpenDashboard = () => {
    chrome.tabs.create({ url: status.settings.dashboardUrl })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${
          serverReachable === null ? 'bg-gray-400' : serverReachable ? 'bg-green-500' : 'bg-red-500'
        }`} />
        <span className="text-sm font-medium text-gray-700">
          {serverReachable === null ? 'Checking...' : serverReachable ? 'Server Available' : 'Server Offline'}
        </span>
      </div>

      {serverReachable === false && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2">
          <div className="flex items-start gap-2">
            <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <p className="text-xs text-yellow-700">
              Server not reachable. Run <code className="font-mono">npm run dev:server</code> first.
            </p>
          </div>
        </div>
      )}

      <CalibrationBadge calibration={status.lastCalibration} />

      <div className="flex flex-col gap-2">
        {!hasCalibration ? (
          <button
            onClick={handleCalibrate}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 active:bg-indigo-700"
          >
            Calibrate First
          </button>
        ) : (
          <button
            onClick={onStartTracking}
            disabled={serverReachable === false}
            className="w-full rounded-lg bg-green-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-500 active:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Start Tracking
          </button>
        )}

        {hasCalibration && (
          <button
            onClick={handleCalibrate}
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100"
          >
            Recalibrate
          </button>
        )}
      </div>

      <button
        onClick={handleOpenDashboard}
        className="flex items-center justify-center gap-1.5 text-xs text-indigo-600 transition-colors hover:text-indigo-500"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
        Open Dashboard
      </button>
    </div>
  )
}
