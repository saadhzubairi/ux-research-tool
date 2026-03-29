import React from 'react'

interface QualityBadgeProps {
  avgErrorPx: number
  size?: 'sm' | 'lg'
}

function getQuality(avgError: number): {
  label: string
  color: string
  bg: string
  borderColor: string
} {
  if (avgError < 80) {
    return {
      label: 'Excellent',
      color: 'text-green-700',
      bg: 'bg-green-100',
      borderColor: 'border-green-300',
    }
  }
  if (avgError < 150) {
    return {
      label: 'Good',
      color: 'text-blue-700',
      bg: 'bg-blue-100',
      borderColor: 'border-blue-300',
    }
  }
  if (avgError < 200) {
    return {
      label: 'Fair',
      color: 'text-yellow-700',
      bg: 'bg-yellow-100',
      borderColor: 'border-yellow-300',
    }
  }
  return {
    label: 'Poor',
    color: 'text-red-700',
    bg: 'bg-red-100',
    borderColor: 'border-red-300',
  }
}

export function QualityBadge({ avgErrorPx, size = 'sm' }: QualityBadgeProps) {
  const quality = getQuality(avgErrorPx)

  if (size === 'lg') {
    return (
      <div
        className={`inline-flex items-center gap-2 rounded-xl border px-6 py-3 ${quality.bg} ${quality.borderColor}`}
      >
        <span className={`text-2xl font-bold ${quality.color}`}>
          {quality.label}
        </span>
      </div>
    )
  }

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${quality.color} ${quality.bg}`}
    >
      {quality.label}
    </span>
  )
}
