import React, { useCallback, useEffect, useState } from 'react'
import { useMediaPipe } from '../calibration/hooks/useMediaPipe'

export function PlaygroundApp() {
  const mediapipe = useMediaPipe()
  const [started, setStarted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [trail, setTrail] = useState<Array<{ x: number; y: number; age: number }>>([])

  const handleStart = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      })
      await mediapipe.start(stream)

      // Load saved calibration model
      const stored = await chrome.storage.local.get('gazekit:model')
      const data = stored['gazekit:model']
      if (data?.coeffsX && data?.coeffsY) {
        // Import the model into the hook by creating fake calibration samples
        // that reproduce the polynomial, then solving. Instead, directly set via exportModel workaround.
        // Actually, we need to load the model into the hook's modelRef.
        // The simplest approach: use the polynomial directly via predictGaze.
        setStarted(true)
      } else {
        setError('No calibration found. Please calibrate first from the extension popup.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [mediapipe])

  // Load model into the hook by importing polynomial functions directly
  const [model, setModel] = useState<{ coeffsX: number[]; coeffsY: number[] } | null>(null)

  useEffect(() => {
    chrome.storage.local.get('gazekit:model').then((stored) => {
      const data = stored['gazekit:model']
      if (data?.coeffsX && data?.coeffsY) {
        setModel({ coeffsX: data.coeffsX, coeffsY: data.coeffsY })
      }
    })
  }, [])

  // Compute gaze position using the saved model + live iris data
  const [gaze, setGaze] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!started || !model) return

    // Use predictGaze with the hook's live normalized iris data
    // The hook's prediction only works if modelRef is set internally.
    // Since we can't set modelRef from outside, we'll read the prediction
    // after the hook has the model. Let's use exportModel to set it.
    // Actually the simplest fix: check mediapipe.prediction which uses modelRef.

    // We need to set the model in the hook. Let's do a workaround:
    // Call exportModel which sets modelRef. But we need samples first.
    // Better approach: extend the hook with a loadModel method.
    // For now, let's use the raw approach: import detectGaze and predictGaze directly.
  }, [started, model])

  return <PlaygroundView model={model} onStart={handleStart} error={error} />
}

// Separate component that handles the actual gaze tracking with direct imports
function PlaygroundView({
  model,
  onStart,
  error,
}: {
  model: { coeffsX: number[]; coeffsY: number[] } | null
  onStart: () => Promise<void>
  error: string | null
}) {
  const [started, setStarted] = useState(false)
  const [gaze, setGaze] = useState<{ x: number; y: number } | null>(null)
  const [trail, setTrail] = useState<Array<{ x: number; y: number; id: number }>>([])
  const [trailId, setTrailId] = useState(0)

  const handleStart = useCallback(async () => {
    if (!model) return
    // Import directly to avoid hook limitations
    const { initFaceLandmarker, detectGaze, closeFaceLandmarker } = await import('../offscreen/faceLandmarker')
    const { predictGaze } = await import('../offscreen/polynomial')

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
    })

    const video = document.createElement('video')
    video.srcObject = stream
    video.width = 640
    video.height = 480
    video.autoplay = true
    video.playsInline = true
    video.muted = true
    video.style.position = 'fixed'
    video.style.opacity = '0'
    video.style.pointerEvents = 'none'
    document.body.appendChild(video)
    await video.play()

    const wasmPath = chrome.runtime.getURL('mediapipe/wasm')
    const modelPath = chrome.runtime.getURL('mediapipe/models/face_landmarker.task')
    await initFaceLandmarker(wasmPath, modelPath)

    setStarted(true)

    let id = 0
    const loop = () => {
      if (video.readyState < 2) {
        requestAnimationFrame(loop)
        return
      }
      const raw = detectGaze(video, performance.now())
      if (raw.normalizedIris) {
        const pred = predictGaze(model, raw.normalizedIris.x, raw.normalizedIris.y)
        setGaze(pred)
        id++
        setTrail((prev) => [...prev.slice(-30), { x: pred.x, y: pred.y, id }])
      }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }, [model])

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
      {gaze && (
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
                ? 'No calibration found. Calibrate first from the extension popup.'
                : 'Test your eye tracking calibration in real-time.'}
            </p>
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
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-green-500" />
            <span className="text-sm text-gray-300">Tracking</span>
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
