import React, { useState, useCallback, useEffect, useRef } from 'react'

interface CalibrationDotProps {
  position: { x: number; y: number }
  clicksRequired: number
  onComplete: () => void
  onRecordClick: (x: number, y: number) => void
  active: boolean
}

const SETTLE_DELAY_MS = 500
const CLICK_COOLDOWN_MS = 150

export function CalibrationDot({
  position,
  clicksRequired,
  onComplete,
  onRecordClick,
  active,
}: CalibrationDotProps) {
  const [clicks, setClicks] = useState(0)
  const [completed, setCompleted] = useState(false)
  const [settled, setSettled] = useState(false)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastClickRef = useRef(0)

  // When dot becomes active, wait for eyes to settle before accepting clicks
  useEffect(() => {
    if (active && !completed) {
      setSettled(false)
      settleTimerRef.current = setTimeout(() => setSettled(true), SETTLE_DELAY_MS)
    }
    return () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    }
  }, [active, completed])

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (completed || !active || !settled) return

      // Cooldown between clicks so users don't spam
      const now = Date.now()
      if (now - lastClickRef.current < CLICK_COOLDOWN_MS) return
      lastClickRef.current = now

      const rect = (e.target as HTMLElement).getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      onRecordClick(centerX, centerY)

      const newClicks = clicks + 1
      setClicks(newClicks)

      if (newClicks >= clicksRequired) {
        setCompleted(true)
        setTimeout(onComplete, 300)
      }
    },
    [clicks, clicksRequired, completed, active, settled, onComplete, onRecordClick]
  )

  if (!active && !completed) return null

  const size = completed ? 20 : 30 - (clicks / clicksRequired) * 10

  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{
        left: `${position.x * 100}%`,
        top: `${position.y * 100}%`,
      }}
    >
      <button
        onClick={handleClick}
        disabled={completed}
        className="group relative flex items-center justify-center focus:outline-none"
      >
        <span
          className={`block rounded-full transition-all duration-300 ${
            completed
              ? 'bg-green-500 opacity-60'
              : settled
                ? 'cursor-pointer bg-indigo-500 hover:bg-indigo-400'
                : 'bg-gray-300'
          }`}
          style={{ width: `${size}px`, height: `${size}px` }}
        />
        {!completed && active && (
          <>
            {settled && (
              <span className="absolute inset-0 animate-ping rounded-full bg-indigo-500/30" style={{ width: `${size + 10}px`, height: `${size + 10}px`, left: '-5px', top: '-5px' }} />
            )}
            <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-1.5 py-0.5 text-xs text-white shadow-sm">
              {settled ? `${clicks}/${clicksRequired}` : 'Look here...'}
            </span>
          </>
        )}
        {completed && (
          <svg
            className="absolute h-4 w-4 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>
    </div>
  )
}
