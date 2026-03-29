import { useState, useRef, useEffect, useCallback } from 'react'
import type { ReplayData } from '@gazekit/shared'
import GazeOverlay from './GazeOverlay'
import EmptyState from '../common/EmptyState'

interface ReplayPlayerProps {
  data: ReplayData | null
  isLoading: boolean
}

type PlaybackSpeed = 0.5 | 1 | 2 | 4

export default function ReplayPlayer({ data, isLoading }: ReplayPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const animFrameRef = useRef<number>(0)
  const startTimeRef = useRef<number>(0)

  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState<PlaybackSpeed>(1)
  const [currentTime, setCurrentTime] = useState(0)
  const [gazeVisible, setGazeVisible] = useState(true)
  const [showFixations, setShowFixations] = useState(false)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })

  const sessionStart = data?.session.startedAt
    ? new Date(data.session.startedAt).getTime()
    : 0
  const sessionDuration = data?.session.durationMs ?? 0

  const gazePoints = (data?.gazeTimeline ?? []).map((p) => ({
    x: p.x,
    y: p.y,
    ts: p.ts - sessionStart,
  }))

  useEffect(() => {
    if (!containerRef.current) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        })
      }
    })

    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!data || !playerRef.current) return

    let mounted = true

    async function loadRRWebPlayer() {
      try {
        const mod = await import('rrweb-player')
        const RRWebPlayer = mod.default ?? mod

        if (!mounted || !playerRef.current || !data) return

        playerRef.current.innerHTML = ''

        new RRWebPlayer({
          target: playerRef.current,
          props: {
            events: data.rrwebEvents,
            width: dimensions.width,
            height: dimensions.height - 60,
            autoPlay: false,
            showController: false,
          },
        })
      } catch (err) {
        console.error('Failed to load rrweb-player:', err)
        if (playerRef.current) {
          playerRef.current.innerHTML = `
            <div class="flex items-center justify-center h-full text-surface-500 text-sm">
              <div class="text-center">
                <p>DOM replay preview</p>
                <p class="text-xs mt-1">rrweb-player will render session recording here</p>
              </div>
            </div>
          `
        }
      }
    }

    loadRRWebPlayer()

    return () => {
      mounted = false
    }
  }, [data, dimensions.width, dimensions.height])

  const tick = useCallback(
    (timestamp: number) => {
      if (!startTimeRef.current) {
        startTimeRef.current = timestamp
      }

      const elapsed = (timestamp - startTimeRef.current) * speed
      const newTime = Math.min(elapsed, sessionDuration)

      setCurrentTime(newTime)

      if (newTime < sessionDuration) {
        animFrameRef.current = requestAnimationFrame(tick)
      } else {
        setIsPlaying(false)
      }
    },
    [speed, sessionDuration],
  )

  useEffect(() => {
    if (isPlaying) {
      startTimeRef.current = 0
      animFrameRef.current = requestAnimationFrame(tick)
    } else {
      cancelAnimationFrame(animFrameRef.current)
    }

    return () => cancelAnimationFrame(animFrameRef.current)
  }, [isPlaying, tick])

  const togglePlay = useCallback(() => {
    if (currentTime >= sessionDuration) {
      setCurrentTime(0)
    }
    setIsPlaying((prev) => !prev)
  }, [currentTime, sessionDuration])

  const handleScrub = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const pct = Number(e.target.value)
      setCurrentTime((pct / 100) * sessionDuration)
      setIsPlaying(false)
    },
    [sessionDuration],
  )

  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000)
    const min = Math.floor(totalSec / 60)
    const sec = totalSec % 60
    return `${min}:${sec.toString().padStart(2, '0')}`
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!data) {
    return (
      <EmptyState
        title="No replay data"
        description="DOM recording data is not available for this session."
      />
    )
  }

  const progressPct = sessionDuration > 0 ? (currentTime / sessionDuration) * 100 : 0

  return (
    <div className="space-y-4">
      <div
        ref={containerRef}
        className="card p-0 overflow-hidden relative"
        style={{ minHeight: 400 }}
      >
        <div ref={playerRef} className="w-full h-full bg-surface-800" style={{ minHeight: 340 }} />
        <GazeOverlay
          points={gazePoints}
          currentTime={currentTime}
          width={dimensions.width}
          height={dimensions.height - 60}
          visible={gazeVisible}
          showFixations={showFixations}
        />
      </div>

      <div className="card flex flex-col gap-3">
        <div className="flex items-center gap-1">
          <span className="text-xs text-surface-400 w-12 text-right tabular-nums">
            {formatTime(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={progressPct}
            onChange={handleScrub}
            className="flex-1 accent-accent-500"
          />
          <span className="text-xs text-surface-400 w-12 tabular-nums">
            {formatTime(sessionDuration)}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={togglePlay} className="btn-primary px-3 py-1.5">
              {isPlaying ? (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            <div className="flex items-center gap-1">
              {([0.5, 1, 2, 4] as PlaybackSpeed[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`px-2 py-1 text-xs rounded font-mono ${
                    speed === s
                      ? 'bg-accent-600 text-white'
                      : 'text-surface-400 hover:text-surface-200 hover:bg-surface-700'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-surface-400 cursor-pointer">
              <input
                type="checkbox"
                checked={gazeVisible}
                onChange={() => setGazeVisible((v) => !v)}
                className="w-3.5 h-3.5 rounded border-surface-600 bg-surface-800 text-accent-600"
              />
              Gaze overlay
            </label>
            <label className="flex items-center gap-2 text-xs text-surface-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showFixations}
                onChange={() => setShowFixations((v) => !v)}
                className="w-3.5 h-3.5 rounded border-surface-600 bg-surface-800 text-accent-600"
              />
              Fixation circles
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
