import React, { useState, useCallback } from 'react'
import type { ExtensionStatus, ExtensionSettings } from '../../types/extension'
import { DEFAULT_SETTINGS } from '../../types/extension'
import { sendToServiceWorker } from '../hooks/useExtensionStatus'
import { usePopupStore } from '../store/popupStore'

interface SettingsPanelProps {
  status: ExtensionStatus
  onClose: () => void
}

type TrackingQuality = 'low' | 'medium' | 'high'

function batchMsToQuality(ms: number): TrackingQuality {
  if (ms >= 100) return 'low'
  if (ms >= 50) return 'medium'
  return 'high'
}

function qualityToBatchMs(quality: TrackingQuality): number {
  switch (quality) {
    case 'low': return 100
    case 'medium': return 50
    case 'high': return 33
  }
}

export function SettingsPanel({ status, onClose }: SettingsPanelProps) {
  const { draftSettings, setDraftSettings, resetDraftSettings } = usePopupStore()

  const [wsPort, setWsPort] = useState(
    draftSettings.wsPort ?? status.settings.wsPort ?? DEFAULT_SETTINGS.wsPort
  )
  const [dashboardUrl, setDashboardUrl] = useState(
    draftSettings.dashboardUrl ?? status.settings.dashboardUrl ?? DEFAULT_SETTINGS.dashboardUrl
  )
  const [quality, setQuality] = useState<TrackingQuality>(
    batchMsToQuality(
      draftSettings.batchIntervalMs ?? status.settings.batchIntervalMs ?? DEFAULT_SETTINGS.batchIntervalMs
    )
  )
  const [screenshotInterval, setScreenshotInterval] = useState(
    Math.round(
      (draftSettings.screenshotIntervalMs ?? status.settings.screenshotIntervalMs ?? DEFAULT_SETTINGS.screenshotIntervalMs) / 1000
    )
  )
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  const handleSave = useCallback(async () => {
    const settings: Partial<ExtensionSettings> = {
      wsPort,
      dashboardUrl,
      batchIntervalMs: qualityToBatchMs(quality),
      screenshotIntervalMs: screenshotInterval * 1000,
    }
    setDraftSettings(settings)
    await sendToServiceWorker({ type: 'update_settings', settings })
    onClose()
  }, [wsPort, dashboardUrl, quality, screenshotInterval, setDraftSettings, onClose])

  const handleClearCalibration = useCallback(async () => {
    await chrome.storage.local.remove('calibration')
    setShowClearConfirm(false)
    resetDraftSettings()
    onClose()
  }, [resetDraftSettings, onClose])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">Settings</h2>
        <button
          onClick={onClose}
          className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">WebSocket Port</span>
          <input
            type="number"
            value={wsPort}
            onChange={(e) => setWsPort(Number(e.target.value))}
            min={1024}
            max={65535}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">Dashboard URL</span>
          <input
            type="text"
            value={dashboardUrl}
            onChange={(e) => setDashboardUrl(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">Tracking Quality</span>
          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value as TrackingQuality)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          >
            <option value="low">Low (10Hz)</option>
            <option value="medium">Medium (20Hz)</option>
            <option value="high">High (30Hz)</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">
            Auto-screenshot Interval: {screenshotInterval}s
          </span>
          <input
            type="range"
            min={1}
            max={10}
            value={screenshotInterval}
            onChange={(e) => setScreenshotInterval(Number(e.target.value))}
            className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-indigo-500"
          />
          <div className="flex justify-between text-xs text-gray-400">
            <span>1s</span>
            <span>10s</span>
          </div>
        </label>
      </div>

      <div className="border-t border-gray-200 pt-3">
        {!showClearConfirm ? (
          <button
            onClick={() => setShowClearConfirm(true)}
            className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-100"
          >
            Clear Calibration Data
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-red-600">
              Are you sure? You will need to recalibrate.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleClearCalibration}
                className="flex-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-500"
              >
                Confirm
              </button>
              <button
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 transition-colors hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <button
        onClick={handleSave}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 active:bg-indigo-700"
      >
        Save
      </button>
    </div>
  )
}
