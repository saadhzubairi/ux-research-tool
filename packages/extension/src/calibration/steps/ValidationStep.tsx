import React, { useState, useEffect, useRef, useCallback } from 'react'
import { ProgressBar } from '../components/ProgressBar'

interface ValidationStepProps {
  getPrediction: () => Promise<{ x: number; y: number } | null>
  prediction: { x: number; y: number } | null
  faceDetected: boolean
  listenerCount: number
  onComplete: (avgErrorPx: number) => void
}

const VALIDATION_POINTS = [
  { x: 0.2, y: 0.2 },
  { x: 0.5, y: 0.15 },
  { x: 0.8, y: 0.25 },
  { x: 0.15, y: 0.5 },
  { x: 0.5, y: 0.5 },
  { x: 0.85, y: 0.5 },
  { x: 0.25, y: 0.75 },
  { x: 0.5, y: 0.85 },
  { x: 0.75, y: 0.8 },
]

const DISPLAY_DURATION_MS = 4000
const SAMPLE_INTERVAL_MS = 50

export function ValidationStep({ getPrediction, prediction, faceDetected, listenerCount, onComplete }: ValidationStepProps) {
  const [currentPointIndex, setCurrentPointIndex] = useState(0)
  const [errors, setErrors] = useState<number[]>([])
  const [collecting, setCollecting] = useState(true)
  const [sampleCount, setSampleCount] = useState(0)
  const [liveError, setLiveError] = useState<number | null>(null)
  const samplesRef = useRef<Array<{ predicted: { x: number; y: number }; actual: { x: number; y: number } }>>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const advanceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const completedRef = useRef(false)

  // Exit fullscreen if it was somehow still active
  useEffect(() => {
    return () => {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {})
      }
    }
  }, [])

  const totalPoints = VALIDATION_POINTS.length
  const currentPoint = VALIDATION_POINTS[currentPointIndex]

  // Compute live error from the reactive prediction prop
  useEffect(() => {
    if (!currentPoint || !prediction) {
      setLiveError(null)
      return
    }
    const actualX = currentPoint.x * window.innerWidth
    const actualY = currentPoint.y * window.innerHeight
    const dx = prediction.x - actualX
    const dy = prediction.y - actualY
    setLiveError(Math.sqrt(dx * dx + dy * dy))
  }, [prediction, currentPoint])

  const collectSamples = useCallback(async () => {
    if (!currentPoint) return
    const pred = await getPrediction()
    if (pred) {
      const actualX = currentPoint.x * window.innerWidth
      const actualY = currentPoint.y * window.innerHeight
      samplesRef.current.push({
        predicted: pred,
        actual: { x: actualX, y: actualY },
      })
      setSampleCount(samplesRef.current.length)
    }
  }, [currentPoint, getPrediction])

  useEffect(() => {
    if (!collecting || !currentPoint) return

    samplesRef.current = []
    setSampleCount(0)

    timerRef.current = setInterval(collectSamples, SAMPLE_INTERVAL_MS)

    advanceRef.current = setTimeout(() => {
      if (timerRef.current) clearInterval(timerRef.current)

      const samples = samplesRef.current
      if (samples.length > 0) {
        const totalError = samples.reduce((sum, s) => {
          const dx = s.predicted.x - s.actual.x
          const dy = s.predicted.y - s.actual.y
          return sum + Math.sqrt(dx * dx + dy * dy)
        }, 0)
        const avgError = totalError / samples.length
        setErrors((prev) => [...prev, avgError])
        console.log(`[GazeKit] Point ${currentPointIndex + 1}: ${samples.length} samples, avg error ${avgError.toFixed(1)}px`)
      } else {
        console.warn(`[GazeKit] Point ${currentPointIndex + 1}: 0 samples collected!`)
      }

      const nextIndex = currentPointIndex + 1
      if (nextIndex >= totalPoints) {
        setCollecting(false)
      } else {
        setCurrentPointIndex(nextIndex)
      }
    }, DISPLAY_DURATION_MS)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (advanceRef.current) clearTimeout(advanceRef.current)
    }
  }, [currentPointIndex, collecting, currentPoint, totalPoints, collectSamples])

  useEffect(() => {
    if (!collecting && !completedRef.current) {
      completedRef.current = true
      const overallAvg = errors.length > 0
        ? errors.reduce((a, b) => a + b, 0) / errors.length
        : 999
      console.log(`[GazeKit] Validation complete: ${errors.length} points measured, avg error ${overallAvg.toFixed(1)}px`)
      setTimeout(() => onComplete(overallAvg), 500)
    }
  }, [collecting, errors, onComplete])

  const targetX = currentPoint ? currentPoint.x * window.innerWidth : 0
  const targetY = currentPoint ? currentPoint.y * window.innerHeight : 0

  return (
    <div className="relative h-screen w-screen bg-white">
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-center px-4 pt-4">
        <p className="rounded-lg bg-gray-100/90 px-4 py-2 text-sm text-gray-700 shadow-sm backdrop-blur">
          Look at the dot (no clicking needed)
        </p>
      </div>

      {/* Target dot */}
      {currentPoint && collecting && (
        <div
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${currentPoint.x * 100}%`,
            top: `${currentPoint.y * 100}%`,
          }}
        >
          <span className="block h-5 w-5 rounded-full bg-indigo-500">
            <span className="absolute inset-0 animate-ping rounded-full bg-indigo-400/40" style={{ width: '28px', height: '28px', left: '-4px', top: '-4px' }} />
          </span>
        </div>
      )}

      {/* Live gaze prediction crosshair */}
      {prediction && collecting && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${prediction.x}px`,
            top: `${prediction.y}px`,
            zIndex: 50,
          }}
        >
          {/* Crosshair */}
          <div className="absolute -left-3 top-0 h-px w-6 bg-red-500" />
          <div className="absolute -top-3 left-0 w-px h-6 bg-red-500" />
          <div className="h-2 w-2 rounded-full bg-red-500 -translate-x-1 -translate-y-1" />
        </div>
      )}

      {/* Error line from target to prediction */}
      {prediction && currentPoint && collecting && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" style={{ zIndex: 45 }}>
          <line
            x1={targetX}
            y1={targetY}
            x2={prediction.x}
            y2={prediction.y}
            stroke="rgba(239,68,68,0.5)"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
        </svg>
      )}

      {/* Debug overlay panel */}
      <div className="absolute left-4 top-16 z-50 rounded-lg border border-gray-200 bg-white/95 p-3 font-mono text-xs shadow-md backdrop-blur" style={{ minWidth: '260px' }}>
        <div className="mb-2 flex items-center gap-2 text-gray-600">
          <div className={`h-2 w-2 rounded-full ${faceDetected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span>Face: {faceDetected ? 'Detected' : 'Not detected'}</span>
        </div>

        <div className="mb-2 flex items-center gap-2 text-gray-600">
          <div className={`h-2 w-2 rounded-full ${listenerCount > 0 ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
          <span>Gaze listener: {listenerCount > 0 ? `${listenerCount} ticks` : 'waiting...'}</span>
        </div>

        <div className="mb-1 text-gray-400">--- Point {currentPointIndex + 1}/{totalPoints} ---</div>

        <div className="text-indigo-600">
          Target: ({Math.round(targetX)}, {Math.round(targetY)})
        </div>

        <div className={prediction ? 'text-red-600' : 'text-gray-300'}>
          Predicted: {prediction ? `(${Math.round(prediction.x)}, ${Math.round(prediction.y)})` : 'null'}
        </div>

        <div className={liveError !== null ? 'text-yellow-600' : 'text-gray-300'}>
          Live error: {liveError !== null ? `${Math.round(liveError)}px` : '---'}
        </div>

        <div className="mt-1 text-gray-500">
          Samples: {sampleCount}
        </div>

        {errors.length > 0 && (
          <div className="mt-2 border-t border-gray-200 pt-2 text-gray-500">
            {errors.map((e, i) => (
              <div key={i} className="text-gray-400">
                Pt {i + 1}: {Math.round(e)}px avg
              </div>
            ))}
          </div>
        )}
      </div>

      {!collecting && (
        <div className="flex h-full items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <svg className="h-8 w-8 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm text-gray-500">Calculating results...</p>
          </div>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 z-10 px-8 pb-6">
        <ProgressBar
          current={collecting ? currentPointIndex + 1 : totalPoints}
          total={totalPoints}
          label={collecting ? `Validation ${currentPointIndex + 1}/${totalPoints}` : 'Complete'}
        />
      </div>
    </div>
  )
}
