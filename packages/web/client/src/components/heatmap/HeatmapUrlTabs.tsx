import type { Page } from '@gazekit/shared'

interface HeatmapUrlTabsProps {
  pages: Page[]
  selectedPageId: string
  onPageChange: (pageId: string) => void
}

function displayUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname + parsed.pathname
  } catch {
    return url
  }
}

/**
 * Page tabs for a session's heatmap view. Unlike the old string-URL grouping,
 * each tab is a distinct Page instance (keyed by pageId), so revisiting the
 * same URL later in a session shows as a separate tab instead of merging.
 */
export default function HeatmapUrlTabs({
  pages,
  selectedPageId,
  onPageChange,
}: HeatmapUrlTabsProps) {
  if (pages.length === 0) return null

  // Disambiguate repeat visits to the same URL with a #n suffix.
  const urlCounts = new Map<string, number>()
  for (const p of pages) urlCounts.set(p.url, (urlCounts.get(p.url) ?? 0) + 1)
  const seen = new Map<string, number>()

  return (
    <div className="mb-4 overflow-x-auto">
      <div className="flex gap-2 bg-surface-900 border-2 border-accent-100 rounded-full p-1.5 w-fit shadow-sticker">
        {pages.map((page) => {
          const isRepeat = (urlCounts.get(page.url) ?? 0) > 1
          const visitNo = (seen.get(page.url) ?? 0) + 1
          seen.set(page.url, visitNo)
          return (
            <button
              key={page._id}
              onClick={() => onPageChange(page._id)}
              className={page._id === selectedPageId ? 'tab-active' : 'tab'}
              title={page.url}
            >
              <span className="truncate max-w-[200px] inline-block align-bottom">
                {displayUrl(page.url)}
                {isRepeat && (
                  <span className="text-surface-500 ml-1">#{visitNo}</span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
