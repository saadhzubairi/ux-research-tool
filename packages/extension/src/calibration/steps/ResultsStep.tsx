import React, { useEffect, useRef } from 'react'
import type { CalibrationResult, PhysicalScreenInfo } from '@gazekit/shared'
import type { CalibrationQualityTier } from '../CalibrationApp'
import type { ValidationResult } from './ValidationStep'

interface ResultsStepProps {
  validation: ValidationResult
  tier: CalibrationQualityTier
  /** Whether the model passed the gate and was persisted */
  modelSaved: boolean
  /** Physical screen info from calibration (null when the user skipped it) */
  physical: PhysicalScreenInfo | null
  onRecalibrate: () => void
  onStartTracking: () => void
}

const TIER_DISPLAY: Record<
  CalibrationQualityTier,
  { label: string; color: string; bg: string; border: string; blurb: string }
> = {
  good: {
    label: 'Good',
    color: 'text-green-700',
    bg: 'bg-green-100',
    border: 'border-green-300',
    blurb: 'Calibration is accurate enough for fixation-level heatmaps.',
  },
  usable: {
    label: 'Usable',
    color: 'text-yellow-700',
    bg: 'bg-yellow-100',
    border: 'border-yellow-300',
    blurb:
      'Tracking will work but heatmap hotspots will be blurry. Recalibrating usually helps — check your lighting and sit ~60cm from the screen.',
  },
  poor: {
    label: 'Poor',
    color: 'text-red-700',
    bg: 'bg-red-100',
    border: 'border-red-300',
    blurb:
      'Accuracy is too low for meaningful heatmaps, so this calibration was NOT saved. Please recalibrate: face the camera straight on, light your face from the front, and keep your head still.',
  },
}

export function ResultsStep({
  validation,
  tier,
  modelSaved,
  physical,
  onRecalibrate,
  onStartTracking,
}: ResultsStepProps) {
  const savedRef = useRef(false)
  const display = TIER_DISPLAY[tier]

  // With physical screen info, degrees are the primary unit (px only means
  // something relative to this particular screen)
  const pxPerDeg =
    physical && Number.isFinite(physical.pxPerDeg) && physical.pxPerDeg > 0
      ? physical.pxPerDeg
      : null
  const fmtMetric = (px: number): string => {
    if (!Number.isFinite(px)) return '—'
    return pxPerDeg ? `${(px / pxPerDeg).toFixed(1)}°` : `${Math.round(px)}px`
  }
  const fmtSub = (px: number): string =>
    pxPerDeg && Number.isFinite(px) ? ` (${Math.round(px)}px)` : ''

  // Persist the session-facing calibration record once — but ONLY when the
  // model itself was saved. Writing it for a rejected calibration would let
  // the popup enable "Start Tracking" (it gates on lastCalibration) and stamp
  // sessions with metadata describing a model that isn't the one running.
  useEffect(() => {
    if (savedRef.current || !modelSaved) return
    savedRef.current = true

    const calibration: CalibrationResult = {
      method: '13-point-ridge',
      avgErrorPx: Number.isFinite(validation.medianErrorPx) ? validation.medianErrorPx : 999,
      precisionPx: Number.isFinite(validation.precisionPx) ? validation.precisionPx : 999,
      qualityScore: tier === 'good' ? 0.9 : tier === 'usable' ? 0.6 : 0.2,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      dpr: window.devicePixelRatio,
      calibratedAt: new Date().toISOString(),
      screenDiagonalMm: physical?.screenDiagonalMm ?? null,
      viewingDistanceMm: physical?.viewingDistanceMm ?? null,
      pxPerDeg: pxPerDeg,
      avgErrorDeg:
        pxPerDeg && Number.isFinite(validation.medianErrorPx)
          ? validation.medianErrorPx / pxPerDeg
          : null,
    }

    chrome.storage.local.set({ calibration })
    chrome.runtime.sendMessage({ type: 'calibration_complete', calibration })
  }, [validation, tier, modelSaved, physical, pxPerDeg])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-gray-50">
      <h1 className="text-2xl font-bold text-gray-900">Calibration Results</h1>

      <div
        className={`inline-flex items-center gap-2 rounded-xl border px-6 py-3 ${display.bg} ${display.border}`}
      >
        <span className={`text-2xl font-bold ${display.color}`}>{display.label}</span>
      </div>

      <div className="flex gap-3">
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-4 text-center shadow-sm">
          <p className="text-2xl font-bold text-gray-800">
            {fmtMetric(validation.medianErrorPx)}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Median Error{fmtSub(validation.medianErrorPx)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-4 text-center shadow-sm">
          <p className="text-2xl font-bold text-gray-800">
            {fmtMetric(validation.precisionPx)}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Precision (jitter){fmtSub(validation.precisionPx)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-4 text-center shadow-sm">
          <p className="text-2xl font-bold text-gray-800">
            {fmtMetric(validation.p95ErrorPx)}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            95th Percentile{fmtSub(validation.p95ErrorPx)}
          </p>
        </div>
      </div>

      {physical && (
        <p className="text-xs text-gray-400">
          Estimated viewing distance: ~{Math.round(physical.viewingDistanceMm / 10)}cm
          · 1° ≈ {Math.round(physical.pxPerDeg)}px on this screen
        </p>
      )}

      <p className="max-w-md text-center text-sm text-gray-600">{display.blurb}</p>

      <div className="flex flex-col gap-3">
        {modelSaved ? (
          <button
            onClick={onStartTracking}
            className="rounded-xl bg-green-600 px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-500 active:bg-green-700"
          >
            Start Tracking
          </button>
        ) : (
          <button
            disabled
            className="cursor-not-allowed rounded-xl bg-gray-300 px-8 py-3 text-sm font-semibold text-gray-500"
            title="Calibration quality too low — recalibrate first"
          >
            Start Tracking
          </button>
        )}
        <button
          onClick={onRecalibrate}
          className={`rounded-xl px-8 py-3 text-sm font-medium transition-colors ${
            tier === 'poor'
              ? 'bg-indigo-600 text-white hover:bg-indigo-500'
              : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          Recalibrate
        </button>
      </div>
    </div>
  )
}
