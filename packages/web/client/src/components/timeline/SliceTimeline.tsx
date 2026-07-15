import { useState, useCallback, useRef, useEffect } from 'react'
import type { SliceListItem } from '@gazekit/shared'

type PlaybackSpeed = 0.5 | 1 | 2 | 4

interface SliceTimelineProps {
  slices: SliceListItem[]
  currentSlice: number
  onCurrentSliceChange: (index: number) => void
  /**
   * Active-session mode: the parent auto-pins `currentSlice` to the latest
   * slice as it streams in ("growing" heatmap). We hide the transport controls
   * and show a LIVE badge instead — scrubbing back is still allowed but the
   * next incoming slice re-pins to the end.
   */
  live?: boolean
}

function elapsedLabel(iso: string, baseIso: string): string {
  const diffSec = Math.max(
    0,
    Math.round((new Date(iso).getTime() - new Date(baseIso).getTime()) / 1000),
  )
  const m = Math.floor(diffSec / 60)
  const s = diffSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function SliceTimeline({
  slices,
  currentSlice,
  onCurrentSliceChange,
  live = false,
}: SliceTimelineProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState<PlaybackSpeed>(1)
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const max = slices.length - 1

  const clearPlay = useCallback(() => {
    if (playRef.current) {
      clearInterval(playRef.current)
      playRef.current = null
    }
  }, [])

  // Cleanup on unmount.
  useEffect(() => clearPlay, [clearPlay])

  // Stop playback if the slice set changes (URL/page switch) or we enter live.
  useEffect(() => {
    clearPlay()
    setIsPlaying(false)
  }, [slices, live, clearPlay])

  const step = useCallback(
    (delta: number) => {
      const next = Math.min(max, Math.max(0, currentSlice + delta))
      onCurrentSliceChange(next)
    },
    [currentSlice, max, onCurrentSliceChange],
  )

  const handleSlider = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onCurrentSliceChange(Number(e.target.value))
    },
    [onCurrentSliceChange],
  )

  // Play/pause auto-advance: one slice per elapsed second, scaled by speed.
  const togglePlay = useCallback(() => {
    setIsPlaying((playing) => {
      if (playing) {
        clearPlay()
        return false
      }
      // Restart from the beginning if parked at the end.
      let startIndex = currentSlice
      if (startIndex >= max) {
        startIndex = 0
        onCurrentSliceChange(0)
      }
      let cursor = startIndex
      playRef.current = setInterval(() => {
        cursor += 1
        if (cursor > max) {
          clearPlay()
          setIsPlaying(false)
          return
        }
        onCurrentSliceChange(cursor)
      }, 1000 / speed)
      return true
    })
  }, [currentSlice, max, speed, onCurrentSliceChange, clearPlay])

  if (slices.length === 0) {
    return (
      <div className="card mt-4 px-5 py-4">
        <p className="text-sm text-surface-500 text-center">
          {live
            ? 'Waiting for the first slice…'
            : 'No slices captured for this page yet.'}
        </p>
      </div>
    )
  }

  const clampedIndex = Math.min(Math.max(0, currentSlice), max)
  const first = slices[0]!
  const current = slices[clampedIndex] ?? first
  const elapsed = elapsedLabel(current.capturedAt, first.capturedAt)
  const total = elapsedLabel(slices[max]!.capturedAt, first.capturedAt)
  const progress = max > 0 ? Math.round((clampedIndex / max) * 100) : 100

  return (
    <div className="card mt-4 px-5 py-4 space-y-3">
      <div className="flex items-center gap-3">
        {live ? (
          <span className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-pink-500/10 text-pink-500 text-xs font-bold">
            <span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse" />
            LIVE
          </span>
        ) : (
          <>
            {/* Prev */}
            <button
              onClick={() => step(-1)}
              disabled={clampedIndex <= 0}
              className="p-2 rounded-full bg-accent-100 hover:bg-accent-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Previous slice"
            >
              <svg className="w-4 h-4 text-accent-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>

            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              className="p-2 rounded-full bg-pink-500 hover:bg-pink-400 shadow-sticker-pink transition-colors"
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
              onClick={() => step(1)}
              disabled={clampedIndex >= max}
              className="p-2 rounded-full bg-accent-100 hover:bg-accent-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Next slice"
            >
              <svg className="w-4 h-4 text-accent-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>

            {/* Speed multiplier */}
            <div className="flex items-center gap-1">
              {([0.5, 1, 2, 4] as PlaybackSpeed[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`px-2.5 py-1 text-xs font-bold rounded-full ${
                    speed === s
                      ? 'bg-accent-600 text-white shadow-sticker-blue'
                      : 'text-surface-400 hover:text-accent-600 hover:bg-accent-50'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Position counter */}
        <span className="text-sm font-medium text-surface-200 tabular-nums">
          {clampedIndex + 1}
          <span className="text-surface-500 mx-0.5">/</span>
          {slices.length}
        </span>

        {/* Time elapsed */}
        <span className="text-sm font-bold text-surface-400 tabular-nums bg-accent-50 px-2.5 py-1 rounded-full">
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
          max={Math.max(0, max)}
          value={clampedIndex}
          onChange={handleSlider}
          className="w-full h-2 appearance-none cursor-pointer rounded-full bg-accent-100
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-pink-500 [&::-webkit-slider-thumb]:shadow-lg
            [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white
            [&::-webkit-slider-thumb]:hover:bg-pink-400 [&::-webkit-slider-thumb]:transition-colors
            [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-pink-500 [&::-moz-range-thumb]:border-2
            [&::-moz-range-thumb]:border-white"
          style={{
            background: `linear-gradient(to right, #4a63c8 ${progress}%, #dfe5f9 ${progress}%)`,
          }}
        />
      </div>

      {/* Context label */}
      <p className="text-xs text-surface-500">
        {live
          ? 'Heatmap is building live as slices stream in — scrub back to review, playback resumes at the latest slice.'
          : 'Showing gaze data accumulated up to this slice in the session'}
      </p>
    </div>
  )
}
