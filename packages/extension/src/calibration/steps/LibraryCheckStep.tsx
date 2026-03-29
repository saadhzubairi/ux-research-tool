import React, { useState, useEffect, useCallback } from 'react'

interface LibraryCheckStepProps {
  isReady: boolean
  faceDetected: boolean
  prediction: { x: number; y: number } | null
  listenerCount: number
  error: string | null
  onNext: () => void
}

export function LibraryCheckStep({
  isReady,
  faceDetected,
  prediction,
  listenerCount,
  error,
  onNext,
}: LibraryCheckStepProps) {
  const [canContinue, setCanContinue] = useState(false)

  useEffect(() => {
    if (listenerCount >= 20 && faceDetected) {
      setCanContinue(true)
    }
  }, [listenerCount, faceDetected])

  const handleContinue = useCallback(() => {
    onNext()
  }, [onNext])

  return (
    <div className="flex h-full flex-col items-center">

      {/* Spacer for the iframe which sits at top: 80px, height: 390px */}
      <div className="h-[480px] shrink-0" />

      {/* Content below iframe */}
      <div className="flex flex-col items-center gap-4 px-4 pb-8">
        <h2 className="text-lg font-semibold text-gray-900">Eye Tracking Check</h2>

        {/* Compact status */}
        <div className="flex items-center gap-6 rounded-xl border border-gray-200 bg-white px-5 py-3 shadow-sm">
          <StatusDot ok={isReady} label="WebGazer" />
          <StatusDot ok={faceDetected} label="Face" />
          <StatusDot ok={listenerCount > 0} label="Gaze" />

          {error ? (
            <span className="text-xs text-red-600">{error}</span>
          ) : prediction ? (
            <span className="font-mono text-xs text-green-600">
              ({prediction.x.toFixed(0)}, {prediction.y.toFixed(0)})
            </span>
          ) : canContinue ? (
            <span className="text-xs text-green-600">Ready</span>
          ) : null}
        </div>

        <p className="max-w-sm text-center text-xs text-gray-400">
          {canContinue
            ? 'Eye tracking is working. Proceed to calibrate — a gaze dot will appear as the model learns.'
            : 'Look at the screen — waiting for eye tracking to lock on...'}
        </p>

        <button
          onClick={handleContinue}
          disabled={!canContinue}
          className={`mt-1 rounded-lg px-6 py-2.5 text-sm font-medium transition-all ${
            canContinue
              ? 'bg-indigo-600 text-white hover:bg-indigo-500'
              : 'cursor-not-allowed bg-gray-200 text-gray-400'
          }`}
        >
          {canContinue ? 'Continue to Calibration' : 'Waiting for eye tracking...'}
        </button>
      </div>
    </div>
  )
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`h-2 w-2 rounded-full ${
          ok ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'
        }`}
      />
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  )
}
