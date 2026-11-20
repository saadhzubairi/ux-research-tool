import React, { useState, useEffect, useRef, useCallback } from 'react'
import { VALIDATION_POINTS } from '@gazekit/shared'
import { ProgressBar } from '../components/ProgressBar'

export interface ValidationResult {
  /** Median of per-point median errors — robust headline accuracy number */
  medianErrorPx: number
  /** 95th percentile of all sample errors — worst-case indicator */
  p95ErrorPx: number
  /** RMS dispersion of predictions around their own centroid (jitter) */
  precisionPx: number
  /** Per-point median error, same order as VALIDATION_POINTS (NaN = no data) */
  perPointErrorPx: number[]
  /** Fraction of the display window that produced valid predictions */
  sampleCoverage: number
}

interface ValidationStepProps {
  getPrediction: () => { x: number; y: number } | null
  prediction: { x: number; y: number } | null
  faceDetected: boolean
  onComplete: (result: ValidationResult) => void
}

// The first portion of each point covers the saccade to the target and
// fixation settling — sampling during it would inflate measured error.
const SETTLE_MS = 800
const SAMPLE_MS = 1700
const SAMPLE_INTERVAL_MS = 50

function median(values: number[]): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number)
}

interface PointSamples {
  errors: number[]
  predictions: Array<{ x: number; y: number }>
  expectedSamples: number
}

export function ValidationStep({ getPrediction, prediction, faceDetected, onComplete }: ValidationStepProps) {
  const [currentPointIndex, setCurrentPointIndex] = useState(0)
  const [settling, setSettling] = useState(true)
  const [collecting, setCollecting] = useState(true)
  const [sampleCount, setSampleCount] = useState(0)
  const [liveError, setLiveError] = useState<number | null>(null)
  const pointResultsRef = useRef<PointSamples[]>([])
  const samplesRef = useRef<PointSamples>({ errors: [], predictions: [], expectedSamples: 0 })
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    setLiveError(Math.hypot(prediction.x - actualX, prediction.y - actualY))
  }, [prediction, currentPoint])

  const collectSample = useCallback(() => {
    if (!currentPoint) return
    samplesRef.current.expectedSamples++
    const pred = getPrediction()
    if (pred && Number.isFinite(pred.x) && Number.isFinite(pred.y)) {
      const actualX = currentPoint.x * window.innerWidth
      const actualY = currentPoint.y * window.innerHeight
      samplesRef.current.errors.push(Math.hypot(pred.x - actualX, pred.y - actualY))
      samplesRef.current.predictions.push(pred)
      setSampleCount(samplesRef.current.errors.length)
    }
  }, [currentPoint, getPrediction])

  useEffect(() => {
    if (!collecting || !currentPoint) return

    samplesRef.current = { errors: [], predictions: [], expectedSamples: 0 }
    setSampleCount(0)
    setSettling(true)

    // Discard the settle window entirely, then sample
    settleTimerRef.current = setTimeout(() => {
      setSettling(false)
      timerRef.current = setInterval(collectSample, SAMPLE_INTERVAL_MS)
    }, SETTLE_MS)

    advanceRef.current = setTimeout(() => {
      if (timerRef.current) clearInterval(timerRef.current)

      pointResultsRef.current.push(samplesRef.current)
      const medErr = median(samplesRef.current.errors)
      console.log(
        `[GazeKit] Validation point ${currentPointIndex + 1}: ${samplesRef.current.errors.length} samples, median error ${Number.isFinite(medErr) ? medErr.toFixed(1) : 'n/a'}px`,
      )

      const nextIndex = currentPointIndex + 1
      if (nextIndex >= totalPoints) {
        setCollecting(false)
      } else {
        setCurrentPointIndex(nextIndex)
      }
    }, SETTLE_MS + SAMPLE_MS)

    return () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
      if (timerRef.current) clearInterval(timerRef.current)
      if (advanceRef.current) clearTimeout(advanceRef.current)
    }
  }, [currentPointIndex, collecting, currentPoint, totalPoints, collectSample])

  useEffect(() => {
    if (collecting || completedRef.current) return
    completedRef.current = true

    const points = pointResultsRef.current
    const perPointErrorPx = points.map((p) => median(p.errors))
    const validMedians = perPointErrorPx.filter((e) => Number.isFinite(e))
    const allErrors = points.flatMap((p) => p.errors).sort((a, b) => a - b)

    // Precision: RMS distance of each point's predictions from their own centroid
    let precisionSq = 0
    let precisionN = 0
    for (const p of points) {
      if (p.predictions.length < 2) continue
      const cx = p.predictions.reduce((s, v) => s + v.x, 0) / p.predictions.length
      const cy = p.predictions.reduce((s, v) => s + v.y, 0) / p.predictions.length
      for (const v of p.predictions) {
        precisionSq += (v.x - cx) ** 2 + (v.y - cy) ** 2
        precisionN++
      }
    }

    const totalExpected = points.reduce((s, p) => s + p.expectedSamples, 0)
    const totalGot = points.reduce((s, p) => s + p.errors.length, 0)

    const result: ValidationResult = {
      medianErrorPx: validMedians.length > 0 ? median(validMedians) : NaN,
      p95ErrorPx:
        allErrors.length > 0
          ? (allErrors[Math.min(allErrors.length - 1, Math.floor(allErrors.length * 0.95))] as number)
          : NaN,
      precisionPx: precisionN > 0 ? Math.sqrt(precisionSq / precisionN) : NaN,
      perPointErrorPx,
      sampleCoverage: totalExpected > 0 ? totalGot / totalExpected : 0,
    }

    console.log(
      `[GazeKit] Validation complete: median ${Number.isFinite(result.medianErrorPx) ? result.medianErrorPx.toFixed(1) : 'n/a'}px, ` +
        `p95 ${Number.isFinite(result.p95ErrorPx) ? result.p95ErrorPx.toFixed(1) : 'n/a'}px, ` +
        `precision ${Number.isFinite(result.precisionPx) ? result.precisionPx.toFixed(1) : 'n/a'}px, ` +
        `coverage ${(result.sampleCoverage * 100).toFixed(0)}%`,
    )
    setTimeout(() => onComplete(result), 500)
  }, [collecting, onComplete])

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
          <span className={`block h-5 w-5 rounded-full ${settling ? 'bg-indigo-300' : 'bg-indigo-500'}`}>
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

        <div className="mb-1 text-gray-400">
          --- Point {currentPointIndex + 1}/{totalPoints} {settling ? '(settling)' : ''} ---
        </div>

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

        {pointResultsRef.current.length > 0 && (
          <div className="mt-2 border-t border-gray-200 pt-2 text-gray-500">
            {pointResultsRef.current.map((p, i) => {
              const m = median(p.errors)
              return (
                <div key={i} className="text-gray-400">
                  Pt {i + 1}: {Number.isFinite(m) ? `${Math.round(m)}px median` : 'no data'}
                </div>
              )
            })}
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
