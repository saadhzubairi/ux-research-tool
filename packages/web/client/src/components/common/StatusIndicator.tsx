interface StatusIndicatorProps {
  status: 'connected' | 'degraded' | 'disconnected'
  size?: 'sm' | 'md'
}

const colorMap = {
  connected: 'bg-green-400',
  degraded: 'bg-yellow-400',
  disconnected: 'bg-red-400',
} as const

const pulseMap = {
  connected: 'bg-green-400/50',
  degraded: 'bg-yellow-400/50',
  disconnected: '',
} as const

export default function StatusIndicator({ status, size = 'sm' }: StatusIndicatorProps) {
  const dotSize = size === 'sm' ? 'w-2 h-2' : 'w-3 h-3'
  const pulseSize = size === 'sm' ? 'w-4 h-4 -m-1' : 'w-5 h-5 -m-1'

  return (
    <span className="relative inline-flex items-center justify-center">
      {status === 'connected' && (
        <span
          className={`absolute ${pulseSize} rounded-full ${pulseMap[status]} animate-ping`}
        />
      )}
      <span className={`relative ${dotSize} rounded-full ${colorMap[status]}`} />
    </span>
  )
}
