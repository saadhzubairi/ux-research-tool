import { useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SessionMeta, SessionsQuery } from '@gazekit/shared'
import { useSessionsQuery, useDeleteSession } from '../../api/hooks'
import SessionCard from './SessionCard'
import DateRangePicker from '../common/DateRangePicker'
import ConfirmDialog from '../common/ConfirmDialog'
import EmptyState from '../common/EmptyState'

type SortField = 'date' | 'duration' | 'gazePoints' | 'quality'
type SortDir = 'asc' | 'desc'

export default function SessionList() {
  const navigate = useNavigate()
  const [urlFilter, setUrlFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [minQuality, setMinQuality] = useState<string>('')
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const filters: SessionsQuery = useMemo(() => {
    const q: SessionsQuery = {}
    if (urlFilter) q.url = urlFilter
    if (fromDate) q.from = fromDate
    if (toDate) q.to = toDate
    return q
  }, [urlFilter, fromDate, toDate])

  const { data: response, isLoading, isError } = useSessionsQuery(filters)
  const deleteSession = useDeleteSession()

  const sessions = response?.data?.sessions ?? []

  const filteredSessions = useMemo(() => {
    let result = [...sessions]

    if (minQuality) {
      const threshold = parseFloat(minQuality)
      result = result.filter((s) => s.calibration.qualityScore >= threshold)
    }

    result.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      switch (sortField) {
        case 'date':
          return dir * (new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
        case 'duration':
          return dir * ((a.durationMs ?? 0) - (b.durationMs ?? 0))
        case 'gazePoints':
          return dir * (a.stats.totalGazePoints - b.stats.totalGazePoints)
        case 'quality':
          return dir * (a.calibration.qualityScore - b.calibration.qualityScore)
        default:
          return 0
      }
    })

    return result
  }, [sessions, minQuality, sortField, sortDir])

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortField(field)
        setSortDir('desc')
      }
    },
    [sortField],
  )

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredSessions.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredSessions.map((s) => s.sessionId)))
    }
  }, [selectedIds.size, filteredSessions])

  const handleBulkDelete = useCallback(() => {
    const ids = Array.from(selectedIds)
    Promise.all(ids.map((id) => deleteSession.mutateAsync(id))).then(() => {
      setSelectedIds(new Set())
      setShowDeleteConfirm(false)
    })
  }, [selectedIds, deleteSession])

  const SORT_OPTIONS: Array<{ field: SortField; label: string }> = [
    { field: 'date', label: 'Date' },
    { field: 'duration', label: 'Duration' },
    { field: 'gazePoints', label: 'Gaze points' },
    { field: 'quality', label: 'Calibration' },
  ]

  function SortPill({ field, label }: { field: SortField; label: string }) {
    const active = sortField === field
    return (
      <button
        onClick={() => handleSort(field)}
        className={active ? 'tab-active' : 'tab'}
      >
        {label}
        {active && (
          <span className="ml-1">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>
        )}
      </button>
    )
  }

  const allSelected =
    selectedIds.size === filteredSessions.length && filteredSessions.length > 0

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (isError) {
    return (
      <EmptyState
        title="Failed to load sessions"
        description="Could not connect to the GazeKit server. Make sure the server is running on the configured port."
      />
    )
  }

  if (sessions.length === 0) {
    return (
      <EmptyState
        title="No sessions yet"
        description="Start tracking eye gaze by installing the GazeKit browser extension and beginning a recording session."
        icon={
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        }
      />
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <input
          type="text"
          placeholder="Filter by URL..."
          value={urlFilter}
          onChange={(e) => setUrlFilter(e.target.value)}
          className="input w-64"
        />
        <DateRangePicker
          from={fromDate}
          to={toDate}
          onFromChange={setFromDate}
          onToChange={setToDate}
        />
        <select
          value={minQuality}
          onChange={(e) => setMinQuality(e.target.value)}
          className="select w-44"
        >
          <option value="">Min calibration...</option>
          <option value="0.8">Excellent (80%+)</option>
          <option value="0.6">Good (60%+)</option>
          <option value="0.4">Fair (40%+)</option>
        </select>

        {selectedIds.size > 0 && (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="btn-danger ml-auto"
          >
            Delete {selectedIds.size} selected
          </button>
        )}
      </div>

      {/* sort + select-all toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs font-extrabold uppercase tracking-wider text-surface-400 mr-1">
          Sort by
        </span>
        {SORT_OPTIONS.map((opt) => (
          <SortPill key={opt.field} field={opt.field} label={opt.label} />
        ))}
        <button onClick={toggleSelectAll} className="btn-ghost ml-auto text-xs">
          {allSelected ? 'Clear selection' : 'Select all'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredSessions.map((session: SessionMeta) => (
          <SessionCard
            key={session.sessionId}
            session={session}
            selected={selectedIds.has(session.sessionId)}
            onToggleSelect={toggleSelect}
            onClick={(id) => navigate(`/sessions/${id}`)}
          />
        ))}
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete Sessions"
        message={`Are you sure you want to delete ${selectedIds.size} session(s)? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleBulkDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}
