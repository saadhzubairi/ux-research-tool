import React, { useState, useEffect, useRef, useCallback } from 'react'

interface CalibrationDotProps {
  position: { x: number; y: number }
  onComplete: () => void
  onRecordSample: (x: number, y: number) => void
  active: boolean
}

// Phase durations
const SETTLE_MS = 2000       // Eyes find and fixate on the dot
const SHRINK_MS = 1500       // Dot shrinks — guides gaze to precise center
const RECORD_MS = 1500       // Hold at min size, auto-record samples
const RECORD_INTERVAL_MS = 50 // ~30 samples per point

// Dot sizes
const MAX_SIZE = 44
const MIN_SIZE = 8

type Phase = 'settling' | 'shrinking' | 'recording' | 'done'

export function CalibrationDot({
  position,
  onComplete,
  onRecordSample,
  active,
}: CalibrationDotProps) {
  const [phase, setPhase] = useState<Phase>('settling')
  const [size, setSize] = useState(MAX_SIZE)
  const [samplesRecorded, setSamplesRecorded] = useState(0)
  const shrinkRafRef = useRef<number | null>(null)
  const recordIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const completedRef = useRef(false)

  // Stable refs for callbacks — prevents effect restarts from parent re-renders
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const onRecordSampleRef = useRef(onRecordSample)
  onRecordSampleRef.current = onRecordSample

  const cleanup = useCallback(() => {
    if (shrinkRafRef.current !== null) {
      cancelAnimationFrame(shrinkRafRef.current)
      shrinkRafRef.current = null
    }
    if (recordIntervalRef.current !== null) {
      clearInterval(recordIntervalRef.current)
      recordIntervalRef.current = null
    }
    if (phaseTimerRef.current !== null) {
      clearTimeout(phaseTimerRef.current)
      phaseTimerRef.current = null
    }
  }, [])

  // Phase machine
  useEffect(() => {
    if (!active || completedRef.current) return
    cleanup()

    setPhase('settling')
    setSize(MAX_SIZE)
    setSamplesRecorded(0)

    // SETTLING → SHRINKING
    phaseTimerRef.current = setTimeout(() => {
      setPhase('shrinking')
    }, SETTLE_MS)

    return cleanup
  }, [active, cleanup])

  // SHRINKING phase — animate dot size from MAX to MIN
  useEffect(() => {
    if (phase !== 'shrinking') return

    const startTime = performance.now()

    const animate = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / SHRINK_MS, 1)
      // Ease-in-out for smooth shrink
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2
      const newSize = MAX_SIZE - (MAX_SIZE - MIN_SIZE) * eased
      setSize(newSize)

      if (progress < 1) {
        shrinkRafRef.current = requestAnimationFrame(animate)
      } else {
        setSize(MIN_SIZE)
        setPhase('recording')
      }
    }

    shrinkRafRef.current = requestAnimationFrame(animate)
    return () => {
      if (shrinkRafRef.current !== null) cancelAnimationFrame(shrinkRafRef.current)
    }
  }, [phase])

  // RECORDING phase — auto-record samples at the dot's center
  useEffect(() => {
    if (phase !== 'recording') return

    const centerX = position.x * window.innerWidth
    const centerY = position.y * window.innerHeight

    let count = 0
    recordIntervalRef.current = setInterval(() => {
      onRecordSampleRef.current(centerX, centerY)
      count++
      setSamplesRecorded(count)
    }, RECORD_INTERVAL_MS)

    phaseTimerRef.current = setTimeout(() => {
      if (recordIntervalRef.current !== null) {
        clearInterval(recordIntervalRef.current)
        recordIntervalRef.current = null
      }
      completedRef.current = true
      setPhase('done')
      setTimeout(() => onCompleteRef.current(), 250)
    }, RECORD_MS)

    return () => {
      if (recordIntervalRef.current !== null) clearInterval(recordIntervalRef.current)
      if (phaseTimerRef.current !== null) clearTimeout(phaseTimerRef.current)
    }
  }, [phase, position])

  if (!active && phase !== 'done') return null

  const isDone = phase === 'done'
  const isRecording = phase === 'recording'
  const isSettling = phase === 'settling'
  const displaySize = isDone ? 16 : size

  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{
        left: `${position.x * 100}%`,
        top: `${position.y * 100}%`,
      }}
    >
      <div className="relative flex items-center justify-center">
        {/* Main dot */}
        <span
          className={`block rounded-full transition-colors duration-300 ${
            isDone
              ? 'bg-green-500 opacity-60'
              : isRecording
                ? 'bg-indigo-600'
                : isSettling
                  ? 'bg-indigo-300'
                  : 'bg-indigo-500'
          }`}
          style={{ width: `${displaySize}px`, height: `${displaySize}px` }}
        />

        {/* Recording pulse ring */}
        {isRecording && (
          <span
            className="absolute animate-ping rounded-full bg-indigo-400/40"
            style={{
              width: `${displaySize + 16}px`,
              height: `${displaySize + 16}px`,
            }}
          />
        )}

        {/* Outer guide ring during settling */}
        {isSettling && (
          <span
            className="absolute rounded-full border-2 border-indigo-300/50 animate-pulse"
            style={{
              width: `${displaySize + 20}px`,
              height: `${displaySize + 20}px`,
            }}
          />
        )}

        {/* Label */}
        {!isDone && active && (
          <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-1.5 py-0.5 text-xs text-white shadow-sm">
            {isSettling
              ? 'Look here...'
              : isRecording
                ? `Recording (${samplesRecorded})`
                : 'Focus...'}
          </span>
        )}

        {/* Done checkmark */}
        {isDone && (
          <svg
            className="absolute h-3 w-3 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
    </div>
  )
}
