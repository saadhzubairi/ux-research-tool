import React, { useState } from 'react'
import { useExtensionStatus } from './hooks/useExtensionStatus'
import { usePopupStore } from './store/popupStore'
import { IdleView } from './components/IdleView'
import { TrackingView } from './components/TrackingView'
import { PausedView } from './components/PausedView'
import { SettingsPanel } from './components/SettingsPanel'
import { TabPickerView } from './components/TabPickerView'

export function PopupApp() {
  const status = useExtensionStatus()
  const { showSettings, setShowSettings } = usePopupStore()
  const [pickingTab, setPickingTab] = useState(false)

  if (!status) {
    return (
      <div className="flex h-48 items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <svg className="h-6 w-6 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-xs text-gray-500">Connecting...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-[200px] w-[320px] flex-col bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <rect x="1" y="1" width="22" height="22" rx="5.5" fill="#4f46e5" />
            <circle cx="12" cy="12" r="7.9" fill="#818cf8" />
            <circle cx="12" cy="12" r="5.3" fill="#fbbf24" />
            <circle cx="12" cy="12" r="2.6" fill="#f97316" />
          </svg>
          <h1 className="text-sm font-bold text-gray-900">ismap</h1>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`rounded p-1.5 transition-colors ${
            showSettings
              ? 'bg-gray-200 text-indigo-600'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
          }`}
          title="Settings"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      <div className="flex-1 px-4 py-3">
        {showSettings ? (
          <SettingsPanel
            status={status}
            onClose={() => setShowSettings(false)}
          />
        ) : status.isTracking && status.isPaused ? (
          <PausedView status={status} />
        ) : status.isTracking ? (
          <TrackingView status={status} />
        ) : pickingTab ? (
          <TabPickerView onBack={() => setPickingTab(false)} />
        ) : (
          <IdleView status={status} onStartTracking={() => setPickingTab(true)} />
        )}
      </div>

      <div className="border-t border-gray-200 px-4 py-2">
        <p className="text-center text-[10px] text-gray-400">
          ismap v0.1.0
        </p>
      </div>
    </div>
  )
}
