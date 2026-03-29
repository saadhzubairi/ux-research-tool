import type { SessionMeta } from '@gazekit/shared'
import { formatDuration, formatDate, formatNumber, truncateText } from '../../utils/formatters'

interface SessionCardProps {
  session: SessionMeta
  selected: boolean
  onToggleSelect: (id: string) => void
  onClick: (id: string) => void
}

function qualityBadge(score: number) {
  if (score >= 0.8) return <span className="badge-success">Excellent</span>
  if (score >= 0.6) return <span className="badge-info">Good</span>
  if (score >= 0.4) return <span className="badge-warning">Fair</span>
  return <span className="badge-danger">Poor</span>
}

function statusBadge(session: SessionMeta) {
  if (!session.endedAt) {
    return <span className="badge-success">Active</span>
  }
  return <span className="badge bg-surface-700 text-surface-300">Completed</span>
}

export default function SessionCard({
  session,
  selected,
  onToggleSelect,
  onClick,
}: SessionCardProps) {
  const urls = session.pages.map((p) => {
    try {
      return new URL(p.url).hostname + new URL(p.url).pathname
    } catch {
      return p.url
    }
  })
  const uniqueUrls = [...new Set(urls)]

  return (
    <tr
      className="table-row cursor-pointer"
      onClick={() => onClick(session.sessionId)}
    >
      <td className="px-4 py-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => {
            e.stopPropagation()
            onToggleSelect(session.sessionId)
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 rounded border-surface-600 bg-surface-800 text-accent-600 focus:ring-accent-500 focus:ring-offset-0"
        />
      </td>
      <td className="px-4 py-3 text-sm text-surface-200">
        {formatDate(session.startedAt)}
      </td>
      <td className="px-4 py-3 text-sm text-surface-300 font-mono">
        {session.durationMs !== null ? formatDuration(session.durationMs) : '--'}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-0.5">
          {uniqueUrls.slice(0, 2).map((url) => (
            <span key={url} className="text-xs text-surface-400 font-mono">
              {truncateText(url, 40)}
            </span>
          ))}
          {uniqueUrls.length > 2 && (
            <span className="text-xs text-surface-500">
              +{uniqueUrls.length - 2} more
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-surface-300 tabular-nums">
        {formatNumber(session.stats.totalGazePoints)}
      </td>
      <td className="px-4 py-3">
        {qualityBadge(session.calibration.qualityScore)}
      </td>
      <td className="px-4 py-3">
        {statusBadge(session)}
      </td>
    </tr>
  )
}
