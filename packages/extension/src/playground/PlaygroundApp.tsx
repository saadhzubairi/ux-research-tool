import React, { useCallback, useEffect, useState } from 'react'
import { useMediaPipe } from '../calibration/hooks/useMediaPipe'
import { isValidGazeModel, type GazeModel } from '../offscreen/regression'

export function PlaygroundApp() {
  const mediapipe = useMediaPipe()
  const [started, setStarted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [model, setModel] = useState<GazeModel | null>(null)
  const [trail, setTrail] = useState<Array<{ x: number; y: number; id: number }>>([])

  // Load + validate the stored calibration model
  useEffect(() => {
    chrome.storage.local.get('gazekit:model').then((stored) => {
      const data: unknown = stored['gazekit:model']
      if (isValidGazeModel(data)) {
        setModel(data)
      }
    })
  }, [])

  const handleStart = useCallback(async () => {
    if (!model) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
          facingMode: 'user',
        },
      })
      await mediapipe.start(stream)
      mediapipe.loadModel(model)
      setStarted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [mediapipe, model])

  // Trail from the hook's live prediction (already in this window's client px)
  const gaze = mediapipe.prediction
  useEffect(() => {
    if (!started || !gaze) return
    setTrail((prev) => [
      ...prev.slice(-30),
      { x: gaze.x, y: gaze.y, id: (prev[prev.length - 1]?.id ?? 0) + 1 },
    ])
  }, [started, gaze])

  const noCalibration = !model

  return (
    <div className="relative h-screen w-screen bg-gray-900">
      {/* Trail dots */}
      {trail.map((point, i) => {
        const opacity = (i + 1) / trail.length
        return (
          <div
            key={point.id}
            className="pointer-events-none fixed rounded-full bg-indigo-400"
            style={{
              left: point.x - 4,
              top: point.y - 4,
              width: 8,
              height: 8,
              opacity: opacity * 0.4,
            }}
          />
        )
      })}

      {/* Main gaze dot */}
      {started && gaze && (
        <div
          className="pointer-events-none fixed z-50 rounded-full border-2 border-white bg-indigo-500 shadow-lg shadow-indigo-500/50"
          style={{
            left: gaze.x - 12,
            top: gaze.y - 12,
            width: 24,
            height: 24,
            transition: 'left 0.05s linear, top 0.05s linear',
          }}
        />
      )}

      {/* UI overlay */}
      {!started && (
        <div className="flex h-full flex-col items-center justify-center gap-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-white">Gaze Playground</h1>
            <p className="mt-2 text-gray-400">
              {noCalibration
                ? 'No valid calibration found. Calibrate first from the extension popup.'
                : 'Test your eye tracking calibration in real-time.'}
            </p>
            {model?.validation && (
              <p className="mt-1 font-mono text-xs text-gray-500">
                calibrated {new Date(model.calibratedAt).toLocaleString()} · median error{' '}
                {Math.round(model.validation.medianErrorPx)}px
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          <button
            onClick={handleStart}
            disabled={noCalibration}
            className="rounded-xl bg-indigo-600 px-8 py-3 text-lg font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Start Playground
          </button>
        </div>
      )}

      {/* Bottom bar */}
      {started && (
        <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-xl border border-gray-700 bg-gray-800/90 px-5 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${mediapipe.faceDetected ? 'animate-pulse bg-green-500' : 'bg-red-500'}`}
            />
            <span className="text-sm text-gray-300">
              {mediapipe.faceDetected ? 'Tracking' : 'Face not detected'}
            </span>
          </div>
          {gaze && (
            <span className="font-mono text-xs text-gray-500">
              ({gaze.x.toFixed(0)}, {gaze.y.toFixed(0)})
            </span>
          )}
          <button
            onClick={() => window.close()}
            className="rounded-lg bg-gray-700 px-3 py-1 text-xs text-gray-300 transition-colors hover:bg-gray-600"
          >
            Close
          </button>
        </div>
      )}
    </div>
  )
}
