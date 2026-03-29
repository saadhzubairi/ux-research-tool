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

  function sortIcon(field: SortField) {
    if (sortField !== field) return null
    return (
      <span className="ml-1 text-accent-400">
        {sortDir === 'asc' ? '\u2191' : '\u2193'}
      </span>
    )
  }

  function SortableHeader({ field, children }: { field: SortField; children: React.ReactNode }) {
    return (
      <th
        className="px-4 py-3 text-left text-xs font-medium text-surface-400 uppercase tracking-wider cursor-pointer hover:text-surface-200 select-none"
        onClick={() => handleSort(field)}
      >
        <span className="inline-flex items-center">
          {children}
          {sortIcon(field)}
        </span>
      </th>
    )
  }

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

      <div className="card p-0 overflow-hidden">
        <table className="w-full">
          <thead className="bg-surface-800/50">
            <tr>
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={selectedIds.size === filteredSessions.length && filteredSessions.length > 0}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-surface-600 bg-surface-800 text-accent-600 focus:ring-accent-500 focus:ring-offset-0"
                />
              </th>
              <SortableHeader field="date">Date</SortableHeader>
              <SortableHeader field="duration">Duration</SortableHeader>
              <th className="px-4 py-3 text-left text-xs font-medium text-surface-400 uppercase tracking-wider">
                URL(s)
              </th>
              <SortableHeader field="gazePoints">Gaze Points</SortableHeader>
              <SortableHeader field="quality">Calibration</SortableHeader>
              <th className="px-4 py-3 text-left text-xs font-medium text-surface-400 uppercase tracking-wider">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredSessions.map((session: SessionMeta) => (
              <SessionCard
                key={session.sessionId}
                session={session}
                selected={selectedIds.has(session.sessionId)}
                onToggleSelect={toggleSelect}
                onClick={(id) => navigate(`/sessions/${id}`)}
              />
            ))}
          </tbody>
        </table>
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
