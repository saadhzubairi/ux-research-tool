import React, { useCallback, useEffect, useRef } from 'react'
import type { CalibrationResult } from '@gazekit/shared'
import { QualityBadge } from '../components/QualityBadge'

interface ResultsStepProps {
  avgErrorPx: number
  onRecalibrate: () => void
  onStartTracking: () => void
}

export function ResultsStep({
  avgErrorPx,
  onRecalibrate,
  onStartTracking,
}: ResultsStepProps) {
  const savedRef = useRef(false)

  // Save calibration immediately when results are shown
  useEffect(() => {
    if (savedRef.current) return
    savedRef.current = true

    const calibration: CalibrationResult = {
      method: '9-point-dwell',
      avgErrorPx,
      precisionPx: avgErrorPx * 0.6,
      qualityScore: avgErrorPx < 80 ? 0.9 : avgErrorPx < 150 ? 0.7 : avgErrorPx < 200 ? 0.5 : 0.3,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      dpr: window.devicePixelRatio,
      calibratedAt: new Date().toISOString(),
    }

    chrome.storage.local.set({ calibration })
    chrome.runtime.sendMessage({ type: 'calibration_complete', calibration })
  }, [avgErrorPx])

  const handleStartTracking = useCallback(() => {
    onStartTracking()
  }, [onStartTracking])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 bg-gray-50">
      <h1 className="text-2xl font-bold text-gray-900">Calibration Results</h1>

      <QualityBadge avgErrorPx={avgErrorPx} size="lg" />

      <div className="rounded-xl border border-gray-200 bg-white px-8 py-4 text-center shadow-sm">
        <p className="text-3xl font-bold text-gray-800">
          {Math.round(avgErrorPx)}px
        </p>
        <p className="mt-1 text-sm text-gray-500">Average Error</p>
      </div>

      <div className="flex flex-col gap-3">
        <button
          onClick={handleStartTracking}
          className="rounded-xl bg-green-600 px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-500 active:bg-green-700"
        >
          Start Tracking
        </button>
        <button
          onClick={onRecalibrate}
          className="rounded-xl border border-gray-300 bg-white px-8 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          Recalibrate
        </button>
      </div>
    </div>
  )
}
