import { useState, useCallback, useRef, useEffect } from 'react'
import type { ScreenshotInfo } from '@gazekit/shared'

interface TimelineSliderProps {
  screenshots: ScreenshotInfo[]
  currentIndex: number
  onIndexChange: (index: number) => void
}

function formatTime(isoString: string, baseIso?: string): string {
  const d = new Date(isoString)
  if (baseIso) {
    const base = new Date(baseIso)
    const diffSec = Math.round((d.getTime() - base.getTime()) / 1000)
    const m = Math.floor(diffSec / 60)
    const s = diffSec % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }
  const m = d.getMinutes().toString().padStart(2, '0')
  const s = d.getSeconds().toString().padStart(2, '0')
  return `${m}:${s}`
}

export default function TimelineSlider({
  screenshots,
  currentIndex,
  onIndexChange,
}: TimelineSliderProps) {
  const [localIndex, setLocalIndex] = useState(currentIndex)
  const [isPlaying, setIsPlaying] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setLocalIndex(currentIndex)
  }, [currentIndex])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (playRef.current) clearInterval(playRef.current)
    }
  }, [])

  const commitIndex = useCallback(
    (val: number) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => onIndexChange(val), 200)
    },
    [onIndexChange],
  )

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Number(e.target.value)
      setLocalIndex(val)
      commitIndex(val)
    },
    [commitIndex],
  )

  const stepPrev = useCallback(() => {
    setLocalIndex((prev) => {
      const next = Math.max(0, prev - 1)
      commitIndex(next)
      return next
    })
  }, [commitIndex])

  const stepNext = useCallback(() => {
    const max = screenshots.length - 1
    setLocalIndex((prev) => {
      const next = Math.min(max, prev + 1)
      commitIndex(next)
      return next
    })
  }, [screenshots.length, commitIndex])

  // Play/pause auto-advance
  const togglePlay = useCallback(() => {
    setIsPlaying((playing) => {
      if (playing) {
        if (playRef.current) clearInterval(playRef.current)
        playRef.current = null
        return false
      }
      // If at end, restart from beginning
      if (localIndex >= screenshots.length - 1) {
        setLocalIndex(0)
        onIndexChange(0)
      }
      playRef.current = setInterval(() => {
        setLocalIndex((prev) => {
          const next = prev + 1
          if (next >= screenshots.length) {
            if (playRef.current) clearInterval(playRef.current)
            playRef.current = null
            setIsPlaying(false)
            return prev
          }
          onIndexChange(next)
          return next
        })
      }, 1000)
      return true
    })
  }, [localIndex, screenshots.length, onIndexChange])

  // Stop playback when screenshots change (URL switch)
  useEffect(() => {
    if (playRef.current) {
      clearInterval(playRef.current)
      playRef.current = null
      setIsPlaying(false)
    }
  }, [screenshots])

  if (screenshots.length === 0) {
    return (
      <div className="card mt-4 px-5 py-4">
        <p className="text-sm text-surface-500 text-center">
          No screenshots captured for this page yet.
        </p>
      </div>
    )
  }

  const max = screenshots.length - 1
  const first = screenshots[0]!
  const current = screenshots[localIndex] ?? first
  const elapsed = formatTime(current.capturedAt, first.capturedAt)
  const total = formatTime(screenshots[max]!.capturedAt, first.capturedAt)
  const progress = max > 0 ? Math.round((localIndex / max) * 100) : 100

  return (
    <div className="card mt-4 px-5 py-4 space-y-3">
      {/* Transport controls row */}
      <div className="flex items-center gap-3">
        {/* Prev */}
        <button
          onClick={stepPrev}
          disabled={localIndex <= 0}
          className="p-2 rounded-md bg-surface-700 hover:bg-surface-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Previous screenshot"
        >
          <svg className="w-4 h-4 text-surface-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>

        {/* Play/Pause */}
        <button
          onClick={togglePlay}
          className="p-2 rounded-md bg-accent-600 hover:bg-accent-500 transition-colors"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5.14v14.72a1 1 0 001.5.86l11-7.36a1 1 0 000-1.72l-11-7.36A1 1 0 008 5.14z" />
            </svg>
          )}
        </button>

        {/* Next */}
        <button
          onClick={stepNext}
          disabled={localIndex >= max}
          className="p-2 rounded-md bg-surface-700 hover:bg-surface-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Next screenshot"
        >
          <svg className="w-4 h-4 text-surface-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Position counter */}
        <span className="text-sm font-medium text-surface-200 tabular-nums">
          {localIndex + 1}
          <span className="text-surface-500 mx-0.5">/</span>
          {screenshots.length}
        </span>

        {/* Time elapsed */}
        <span className="text-sm text-surface-400 tabular-nums bg-surface-800 px-2.5 py-1 rounded-md">
          {elapsed}
          <span className="text-surface-600 mx-1">/</span>
          {total}
        </span>
      </div>

      {/* Slider track */}
      <div className="relative">
        <input
          type="range"
          min={0}
          max={max}
          value={localIndex}
          onChange={handleSliderChange}
          className="w-full h-2 appearance-none cursor-pointer rounded-full bg-surface-700
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent-500 [&::-webkit-slider-thumb]:shadow-lg
            [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white/20
            [&::-webkit-slider-thumb]:hover:bg-accent-400 [&::-webkit-slider-thumb]:transition-colors
            [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-accent-500 [&::-moz-range-thumb]:border-2
            [&::-moz-range-thumb]:border-white/20"
          style={{
            background: `linear-gradient(to right, #6366f1 ${progress}%, #2a2a2a ${progress}%)`,
          }}
        />
      </div>

      {/* Context label */}
      <p className="text-xs text-surface-500">
        Showing gaze data accumulated up to this point in the session
      </p>
    </div>
  )
}
