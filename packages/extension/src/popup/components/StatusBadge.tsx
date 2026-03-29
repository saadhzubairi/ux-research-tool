import React from 'react'

interface StatusBadgeProps {
  status: 'connected' | 'disconnected' | 'reconnecting'
}

const statusConfig = {
  connected: {
    color: 'bg-green-500',
    ring: 'ring-green-500/30',
    text: 'Connected',
    textColor: 'text-green-400',
  },
  disconnected: {
    color: 'bg-red-500',
    ring: 'ring-red-500/30',
    text: 'Disconnected',
    textColor: 'text-red-400',
  },
  reconnecting: {
    color: 'bg-yellow-500',
    ring: 'ring-yellow-500/30',
    text: 'Reconnecting...',
    textColor: 'text-yellow-400',
  },
} as const

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status]

  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full ${config.color} ring-4 ${config.ring}`}
      />
      <span className={`text-xs font-medium ${config.textColor}`}>
        {config.text}
      </span>
    </div>
  )
}
