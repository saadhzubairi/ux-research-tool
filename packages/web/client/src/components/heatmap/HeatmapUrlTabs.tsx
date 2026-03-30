interface HeatmapUrlTabsProps {
  urls: string[]
  selectedUrl: string
  onUrlChange: (url: string) => void
}

function displayUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname + parsed.pathname
  } catch {
    return url
  }
}

export default function HeatmapUrlTabs({
  urls,
  selectedUrl,
  onUrlChange,
}: HeatmapUrlTabsProps) {
  if (urls.length === 0) return null

  return (
    <div className="border-b border-surface-700 mb-4 overflow-x-auto">
      <div className="flex gap-0">
        {urls.map((url) => (
          <button
            key={url}
            onClick={() => onUrlChange(url)}
            className={url === selectedUrl ? 'tab-active' : 'tab'}
            title={url}
          >
            <span className="truncate max-w-[200px] inline-block align-bottom">
              {displayUrl(url)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
