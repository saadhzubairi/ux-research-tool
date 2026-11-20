import type { SessionMeta } from '@gazekit/shared'
import { formatDuration, formatDate, formatNumber } from '../../utils/formatters'

interface SessionCardProps {
  session: SessionMeta
  selected: boolean
  onToggleSelect: (id: string) => void
  onClick: (id: string) => void
}

// Two sticker accents we rotate between so a wall of cards stays playful.
const ACCENTS = [
  {
    blob: 'from-accent-300 to-accent-500',
    chip: 'bg-accent-100 text-accent-700',
    ring: 'group-hover:border-accent-300 hover:shadow-sticker-blue',
  },
  {
    blob: 'from-pink-300 to-pink-500',
    chip: 'bg-pink-100 text-pink-600',
    ring: 'group-hover:border-pink-300 hover:shadow-sticker-pink',
  },
] as const

function accentFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return ACCENTS[Math.abs(h) % ACCENTS.length]!
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function qualityBadge(score: number) {
  if (score >= 0.8) return <span className="badge-success">Excellent</span>
  if (score >= 0.6) return <span className="badge-info">Good</span>
  if (score >= 0.4) return <span className="badge-warning">Fair</span>
  return <span className="badge-danger">Poor</span>
}

function statusBadge(session: SessionMeta) {
  if (session.status === 'active') {
    return (
      <span className="badge bg-emerald-100 text-emerald-700 gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        Active
      </span>
    )
  }
  if (session.status === 'error') return <span className="badge-danger">Error</span>
  return <span className="badge bg-surface-700 text-surface-300">Completed</span>
}

export default function SessionCard({
  session,
  selected,
  onToggleSelect,
  onClick,
}: SessionCardProps) {
  const accent = accentFor(session.sessionId)
  const hosts = [...new Set((session.pages ?? []).map((p) => hostOf(p.url)))]
  const primary = hosts[0] ?? 'unknown'
  const extra = hosts.length - 1

  return (
    <div
      onClick={() => onClick(session.sessionId)}
      className={`card group relative flex flex-col cursor-pointer p-0 overflow-hidden transition-all duration-200 hover:-translate-y-1 ${accent.ring} ${
        selected ? 'border-pink-400 ring-2 ring-pink-200' : ''
      }`}
    >
      {/* selection checkbox */}
      <label
        onClick={(e) => e.stopPropagation()}
        className="absolute top-3 right-3 z-10"
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(session.sessionId)}
          className="checkbox w-5 h-5"
        />
      </label>

      {/* header */}
      <div className="flex items-center gap-3 p-4 pb-3">
        <div
          className={`flex-shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br ${accent.blob} grid place-items-center text-white text-xl font-display font-bold shadow-sticker`}
        >
          {primary.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-display font-bold text-surface-100 truncate">
            {primary}
          </div>
          {extra > 0 && (
            <span className={`badge mt-1 ${accent.chip}`}>+{extra} more</span>
          )}
        </div>
      </div>

      {/* stats */}
      <div className="grid grid-cols-2 gap-px bg-accent-100 mx-4 rounded-2xl overflow-hidden">
        <div className="bg-surface-900 px-3 py-2.5">
          <div className="text-lg font-display font-bold text-surface-100 tabular-nums leading-none">
            {formatNumber(session.stats.totalGazePoints)}
          </div>
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-surface-400 mt-1">
            Gaze pts 👀
          </div>
        </div>
        <div className="bg-surface-900 px-3 py-2.5">
          <div className="text-lg font-display font-bold text-surface-100 font-mono leading-none">
            {session.durationMs !== null ? formatDuration(session.durationMs) : '--'}
          </div>
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-surface-400 mt-1">
            Duration
          </div>
        </div>
      </div>

      {/* footer */}
      <div className="flex items-center justify-between gap-2 p-4 pt-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          {qualityBadge(session.calibration.qualityScore)}
          {statusBadge(session)}
        </div>
        <span className="text-[11px] font-bold text-surface-500 whitespace-nowrap">
          {formatDate(session.startedAt)}
        </span>
      </div>
    </div>
  )
}
