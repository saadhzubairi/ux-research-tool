import React, { useState, useEffect } from 'react'
import { sendToServiceWorker } from '../hooks/useExtensionStatus'

interface TabInfo {
  id: number
  title: string
  url: string
  favIconUrl: string | undefined
}

interface TabPickerViewProps {
  onBack: () => void
}

export function TabPickerView({ onBack }: TabPickerViewProps) {
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTabId, setSelectedTabId] = useState<number | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    const loadTabs = async () => {
      const allTabs = await chrome.tabs.query({ currentWindow: true })

      const filtered: TabInfo[] = allTabs
        .filter((t) => t.id !== undefined)
        .filter((t) => !t.url?.startsWith('chrome://') && !t.url?.startsWith('chrome-extension://'))
        .map((t) => ({
          id: t.id!,
          title: t.title || 'Untitled',
          url: t.url || '',
          favIconUrl: t.favIconUrl,
        }))

      setTabs(filtered)

      // Auto-select the currently active tab
      const activeTab = allTabs.find((t) => t.active)
      if (activeTab?.id && filtered.some((t) => t.id === activeTab.id)) {
        setSelectedTabId(activeTab.id)
      }

      setLoading(false)
    }

    loadTabs()
  }, [])

  const handleStart = async () => {
    if (!selectedTabId) return
    setStarting(true)
    await sendToServiceWorker({ type: 'start_session', targetTabId: selectedTabId })
  }

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <svg className="h-5 w-5 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <p className="text-xs font-semibold text-gray-700">Select a tab to track</p>
      </div>

      {tabs.length === 0 ? (
        <p className="py-4 text-center text-xs text-gray-400">No eligible tabs found.</p>
      ) : (
        <>
          <div className="max-h-[220px] space-y-1 overflow-y-auto">
            {tabs.map((tab) => {
              const isSelected = tab.id === selectedTabId
              return (
                <button
                  key={tab.id}
                  onClick={() => setSelectedTabId(tab.id)}
                  className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? 'border-green-400 bg-green-50 ring-1 ring-green-400'
                      : 'border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50'
                  }`}
                >
                  {tab.favIconUrl ? (
                    <img src={tab.favIconUrl} alt="" className="h-4 w-4 shrink-0 rounded" />
                  ) : (
                    <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-gray-200 text-[10px] text-gray-400">?</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-xs font-medium ${isSelected ? 'text-green-800' : 'text-gray-800'}`}>{tab.title}</p>
                    <p className="truncate text-[10px] text-gray-400">{tab.url}</p>
                  </div>
                  {isSelected && (
                    <svg className="h-4 w-4 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>

          <button
            onClick={handleStart}
            disabled={!selectedTabId || starting}
            className="mt-1 w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-500 active:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {starting ? 'Starting...' : 'Start'}
          </button>
        </>
      )}
    </div>
  )
}
