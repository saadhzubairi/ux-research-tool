import { useState, useMemo, useCallback } from 'react'
import type { ElementAttention } from '@gazekit/shared'
import { formatDuration, truncateText } from '../../utils/formatters'
import EmptyState from '../common/EmptyState'

interface ElementTableProps {
  elements: ElementAttention[]
  isLoading: boolean
}

type SortField = 'dwell' | 'fixations' | 'avgFixation' | 'firstSeen' | 'attention'
type SortDir = 'asc' | 'desc'

export default function ElementTable({ elements, isLoading }: ElementTableProps) {
  const [sortField, setSortField] = useState<SortField>('dwell')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const sorted = useMemo(() => {
    const result = [...elements]
    const dir = sortDir === 'asc' ? 1 : -1

    result.sort((a, b) => {
      switch (sortField) {
        case 'dwell':
          return dir * (a.totalDwellMs - b.totalDwellMs)
        case 'fixations':
          return dir * (a.fixationCount - b.fixationCount)
        case 'avgFixation':
          return dir * (a.avgFixationMs - b.avgFixationMs)
        case 'firstSeen':
          return dir * (a.firstFixationTs - b.firstFixationTs)
        case 'attention':
          return dir * (a.percentOfTotalDwell - b.percentOfTotalDwell)
        default:
          return 0
      }
    })

    return result
  }, [elements, sortField, sortDir])

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

  if (elements.length === 0) {
    return (
      <EmptyState
        title="No element data"
        description="Element attention data will appear here once gaze tracking data has been processed."
      />
    )
  }

  return (
    <div className="card p-0 overflow-x-auto">
      <table className="w-full">
        <thead className="bg-surface-800/50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-surface-400 uppercase tracking-wider">
              Element
            </th>
            <SortableHeader field="dwell">Dwell Time</SortableHeader>
            <SortableHeader field="fixations">Fixations</SortableHeader>
            <SortableHeader field="avgFixation">Avg Fixation</SortableHeader>
            <SortableHeader field="firstSeen">First Seen</SortableHeader>
            <SortableHeader field="attention">% Attention</SortableHeader>
          </tr>
        </thead>
        <tbody>
          {sorted.map((el) => (
            <tr key={el.selector} className="table-row">
              <td className="px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm text-surface-200 font-mono">
                    {truncateText(el.selector, 40)}
                  </span>
                  <span className="text-xs text-surface-500">
                    &lt;{el.tag}&gt;
                    {el.text && (
                      <span className="ml-1 text-surface-400">
                        {truncateText(el.text, 30)}
                      </span>
                    )}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-surface-300 font-mono tabular-nums">
                {formatDuration(el.totalDwellMs)}
              </td>
              <td className="px-4 py-3 text-sm text-surface-300 tabular-nums">
                {el.fixationCount}
              </td>
              <td className="px-4 py-3 text-sm text-surface-300 font-mono tabular-nums">
                {Math.round(el.avgFixationMs)}ms
              </td>
              <td className="px-4 py-3 text-sm text-surface-300 font-mono tabular-nums">
                {formatRelativeTime(el.firstFixationTs)}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-surface-700 rounded-full overflow-hidden max-w-[100px]">
                    <div
                      className="h-full bg-accent-500 rounded-full"
                      style={{ width: `${Math.min(el.percentOfTotalDwell, 100)}%` }}
                    />
                  </div>
                  <span className="text-sm text-surface-300 tabular-nums w-12 text-right">
                    {el.percentOfTotalDwell.toFixed(1)}%
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function formatRelativeTime(ts: number): string {
  const sec = Math.floor(ts / 1000)
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  if (min > 0) {
    return `${min}m ${remSec}s`
  }
  return `${remSec}s`
}
