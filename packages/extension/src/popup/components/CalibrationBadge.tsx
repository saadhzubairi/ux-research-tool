import React from 'react'
import type { CalibrationResult } from '@gazekit/shared'

interface CalibrationBadgeProps {
  calibration: CalibrationResult | null
}

function getQualityLabel(score: number): {
  label: string
  color: string
  bg: string
} {
  if (score >= 0.8) return { label: 'Excellent', color: 'text-green-700', bg: 'bg-green-100' }
  if (score >= 0.6) return { label: 'Good', color: 'text-blue-700', bg: 'bg-blue-100' }
  if (score >= 0.4) return { label: 'Fair', color: 'text-yellow-700', bg: 'bg-yellow-100' }
  return { label: 'Poor', color: 'text-red-700', bg: 'bg-red-100' }
}

function getTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function CalibrationBadge({ calibration }: CalibrationBadgeProps) {
  if (!calibration) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
        <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <span className="text-xs text-gray-500">Not calibrated</span>
      </div>
    )
  }

  const quality = getQualityLabel(calibration.qualityScore)
  const timeAgo = getTimeAgo(calibration.calibratedAt)

  return (
    <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
      <div className="flex items-center gap-2">
        <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        <span className="text-xs text-gray-500">{timeAgo}</span>
      </div>
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${quality.color} ${quality.bg}`}>
        {quality.label}
      </span>
    </div>
  )
}
