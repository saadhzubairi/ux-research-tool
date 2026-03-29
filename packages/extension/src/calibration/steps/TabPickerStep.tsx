import React, { useState, useEffect } from 'react'

interface TabPickerStepProps {
  onSelectTab: (tabId: number) => void
}

interface TabInfo {
  id: number
  title: string
  url: string
  favIconUrl: string | undefined
}

export function TabPickerStep({ onSelectTab }: TabPickerStepProps) {
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadTabs = async () => {
      const allTabs = await chrome.tabs.query({ currentWindow: true })
      const currentTabId = (await chrome.tabs.getCurrent())?.id

      const filtered: TabInfo[] = allTabs
        .filter((t) => t.id !== undefined && t.id !== currentTabId)
        .filter((t) => !t.url?.startsWith('chrome://') && !t.url?.startsWith('chrome-extension://'))
        .map((t) => ({
          id: t.id!,
          title: t.title || 'Untitled',
          url: t.url || '',
          favIconUrl: t.favIconUrl,
        }))

      setTabs(filtered)
      setLoading(false)
    }

    loadTabs()
  }, [])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <svg className="h-8 w-8 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm text-gray-500">Loading tabs...</p>
        </div>
      </div>
    )
  }

  if (tabs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-sm rounded-xl border border-yellow-200 bg-yellow-50 p-6 text-center">
          <p className="text-sm text-gray-700">No eligible tabs found. Open a website in another tab first.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">Select a Tab to Track</h1>
        <p className="mt-2 text-sm text-gray-500">Choose which tab to overlay the gaze heatmap on</p>
      </div>

      <div className="w-full max-w-lg space-y-2 px-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50"
          >
            {tab.favIconUrl ? (
              <img src={tab.favIconUrl} alt="" className="h-5 w-5 shrink-0 rounded" />
            ) : (
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-gray-200 text-xs text-gray-500">
                ?
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">{tab.title}</p>
              <p className="truncate text-xs text-gray-400">{tab.url}</p>
            </div>
            <svg className="h-4 w-4 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  )
}
