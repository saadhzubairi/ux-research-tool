// packages/extension/src/calibration/hooks/useMediaPipe.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  initFaceLandmarker,
  detectGazeFrame,
  closeFaceLandmarker,
} from '../../offscreen/faceLandmarker'
import { BlinkDetector, type FrameFeatures, type HeadPose } from '../../offscreen/features'
import {
  fitGazeModelFromSamples,
  predictScreenPx,
  type CalibrationSample,
  type CalibrationSampleKind,
  type GazeModel,
} from '../../offscreen/regression'
import {
  captureWindowGeometry,
  clientToScreen,
  screenToClient,
} from '@gazekit/shared'

const SAMPLE_FRESHNESS_MS = 150
const PREDICTION_FRESHNESS_MS = 250

export interface UseMediaPipeReturn {
  isReady: boolean
  faceDetected: boolean
  /** Live prediction in CLIENT px of the current window (null before fit) */
  prediction: { x: number; y: number } | null
  error: string | null
  start: (stream: MediaStream) => Promise<void>
  stop: () => void
  /**
   * Record one calibration sample: the user's gaze target is at
   * (clientX, clientY), tagged with the pursuit-path segment it belongs to.
   * Returns true when a fresh, blink-free, not-yet-recorded frame was
   * captured.
   */
  recordCalibrationSample: (
    clientX: number,
    clientY: number,
    group: string,
    kind: CalibrationSampleKind,
  ) => boolean
  /** Fit + persistable model. Throws with a user-facing message on failure. */
  exportModel: () => GazeModel
  /** Inject a stored model (playground / re-validation). */
  loadModel: (model: GazeModel) => void
  /** Fresh prediction in client px, or null if stale (blink/face lost). */
  getPrediction: () => { x: number; y: number } | null
  resetCalibration: () => void
}

interface RecordedSample {
  group: string
  kind: CalibrationSampleKind
  screenX: number
  screenY: number
  features: number[]
  headPose: HeadPose
  interocular: number
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number)
}

export function useMediaPipe(): UseMediaPipeReturn {
  const [isReady, setIsReady] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [prediction, setPrediction] = useState<{ x: number; y: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const predictionRef = useRef<{ x: number; y: number } | null>(null)
  const predictionTsRef = useRef(0)
  const latestFrameRef = useRef<{ frame: FrameFeatures; ts: number; blinking: boolean } | null>(null)
  const lastRecordedFrameTsRef = useRef(0)
  const samplesRef = useRef<RecordedSample[]>([])
  const modelRef = useRef<GazeModel | null>(null)
  const blinkDetectorRef = useRef(new BlinkDetector())
  const cameraDeviceIdRef = useRef<string | null>(null)
  const cameraSizeRef = useRef<{ width: number; height: number } | null>(null)
  // chrome-extension:// pages honor the user's page zoom too — assume nothing
  const zoomRef = useRef(1)
  const ownTabIdRef = useRef<number | null>(null)

  const start = useCallback(async (stream: MediaStream) => {
    try {
      streamRef.current = stream
      const trackSettings = stream.getVideoTracks()[0]?.getSettings()
      cameraDeviceIdRef.current = trackSettings?.deviceId ?? null
      cameraSizeRef.current =
        trackSettings?.width && trackSettings?.height
          ? { width: trackSettings.width, height: trackSettings.height }
          : null

      // Fetch this tab's real page zoom — the coordinate transform is wrong
      // for users with a non-100% default zoom otherwise
      try {
        const tab = await chrome.tabs.getCurrent()
        if (tab?.id !== undefined) {
          ownTabIdRef.current = tab.id
          zoomRef.current = await chrome.tabs.getZoom(tab.id)
        }
      } catch {
        zoomRef.current = 1
      }

      // Create hidden video element
      const video = document.createElement('video')
      video.srcObject = stream
      video.autoplay = true
      video.playsInline = true
      video.muted = true
      video.style.position = 'fixed'
      video.style.opacity = '0'
      video.style.pointerEvents = 'none'
      document.body.appendChild(video)
      await video.play()
      videoRef.current = video

      // Initialize MediaPipe
      const wasmPath = chrome.runtime.getURL('mediapipe/wasm')
      const modelPath = chrome.runtime.getURL('mediapipe/models/face_landmarker.task')
      await initFaceLandmarker(wasmPath, modelPath)

      setIsReady(true)

      // Prediction loop
      const loop = (): void => {
        if (!videoRef.current || videoRef.current.readyState < 2) {
          rafRef.current = requestAnimationFrame(loop)
          return
        }

        const raw = detectGazeFrame(videoRef.current, performance.now())
        setFaceDetected(raw.faceDetected)

        if (raw.frame) {
          const now = performance.now()
          const blinking = blinkDetectorRef.current.update(raw.frame.ear, now)
          latestFrameRef.current = { frame: raw.frame, ts: now, blinking }

          if (modelRef.current && !blinking) {
            const screenPx = predictScreenPx(modelRef.current, raw.frame.features)
            if (Number.isFinite(screenPx.x) && Number.isFinite(screenPx.y)) {
              // Convert model output (global screen px) to this window's client px
              const geometry = captureWindowGeometry(window, zoomRef.current)
              const pred = screenToClient(geometry, screenPx.x, screenPx.y)
              predictionRef.current = pred
              predictionTsRef.current = now
              setPrediction(pred)
            }
          }
        } else {
          // Landmarks dropped out (with or without a face box) — never let a
          // stale frame masquerade as live data
          latestFrameRef.current = null
          if (!raw.faceDetected) {
            predictionRef.current = null
            setPrediction(null)
          }
        }

        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  // Track zoom changes on this tab during calibration
  useEffect(() => {
    const listener = (info: chrome.tabs.ZoomChangeInfo): void => {
      if (ownTabIdRef.current !== null && info.tabId === ownTabIdRef.current) {
        zoomRef.current = info.newZoomFactor
      }
    }
    chrome.tabs.onZoomChange.addListener(listener)
    return () => chrome.tabs.onZoomChange.removeListener(listener)
  }, [])

  const recordCalibrationSample = useCallback(
    (clientX: number, clientY: number, group: string, kind: CalibrationSampleKind): boolean => {
      // Use the latest frame from the prediction loop — do NOT call detectGazeFrame()
      // again, as running two concurrent MediaPipe inferences causes severe lag.
      const latest = latestFrameRef.current
      if (!latest) return false
      if (latest.blinking) return false
      if (performance.now() - latest.ts > SAMPLE_FRESHNESS_MS) return false
      // The recorder ticks faster than the camera delivers frames — a frame
      // must contribute at most one sample or duplicates would overweight it
      if (latest.ts === lastRecordedFrameTsRef.current) return false
      lastRecordedFrameTsRef.current = latest.ts

      const geometry = captureWindowGeometry(window, zoomRef.current)
      const screen = clientToScreen(geometry, clientX, clientY)
      samplesRef.current.push({
        group,
        kind,
        screenX: screen.x,
        screenY: screen.y,
        features: [...latest.frame.features],
        headPose: { ...latest.frame.headPose },
        interocular: latest.frame.interocular,
      })
      return true
    },
    [],
  )

  const exportModel = useCallback((): GazeModel => {
    const all = samplesRef.current
    const calibrationSamples: CalibrationSample[] = all.map((s) => ({
      screenX: s.screenX,
      screenY: s.screenY,
      features: s.features,
      group: s.group,
      kind: s.kind,
    }))

    const fit = fitGazeModelFromSamples(calibrationSamples)

    // Clamp box for runtime predictions, anchored to where calibration
    // actually happened on the (possibly multi-monitor) desktop
    const calibBounds = {
      left: Math.min(...all.map((s) => s.screenX)),
      top: Math.min(...all.map((s) => s.screenY)),
      right: Math.max(...all.map((s) => s.screenX)),
      bottom: Math.max(...all.map((s) => s.screenY)),
    }

    // Reference head state = median over the stationary dwell samples (the
    // vor phase deliberately swings the head and must not shift the reference)
    const dwellSamples = all.filter((s) => s.kind === 'dwell')
    const refSource = dwellSamples.length >= 10 ? dwellSamples : all
    const refHeadPose = {
      yaw: median(refSource.map((s) => s.headPose.yaw)),
      pitch: median(refSource.map((s) => s.headPose.pitch)),
      roll: median(refSource.map((s) => s.headPose.roll)),
    }
    const refInterocular = median(refSource.map((s) => s.interocular))

    const model: GazeModel = {
      version: 3,
      weightsX: fit.weightsX,
      weightsY: fit.weightsY,
      featMean: fit.featMean,
      featStd: fit.featStd,
      lambda: fit.lambda,
      trainRmsePx: fit.trainRmsePx,
      calibScreen: { width: window.screen.width, height: window.screen.height },
      calibBounds,
      calibWindow: captureWindowGeometry(window, zoomRef.current),
      refHeadPose,
      refInterocular,
      cameraDeviceId: cameraDeviceIdRef.current,
      cameraSize: cameraSizeRef.current,
      fitStats: {
        usedGroups: fit.usedGroups,
        usedSamples: fit.usedSamples,
        prunedSamples: fit.prunedSamples,
      },
      calibratedAt: new Date().toISOString(),
      validation: null,
    }
    modelRef.current = model
    return model
  }, [])

  const loadModel = useCallback((model: GazeModel) => {
    modelRef.current = model
  }, [])

  const getPrediction = useCallback(() => {
    // Blinks and landmark dropouts stop updates — a frozen prediction must
    // not be sampled as if it were live (it would corrupt validation metrics)
    if (performance.now() - predictionTsRef.current > PREDICTION_FRESHNESS_MS) return null
    return predictionRef.current
  }, [])

  const resetCalibration = useCallback(() => {
    samplesRef.current = []
    modelRef.current = null
    predictionRef.current = null
    lastRecordedFrameTsRef.current = 0
    setPrediction(null)
  }, [])

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    closeFaceLandmarker()
    if (videoRef.current) {
      videoRef.current.remove()
      videoRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setIsReady(false)
    setFaceDetected(false)
    setPrediction(null)
    latestFrameRef.current = null
    predictionRef.current = null
    blinkDetectorRef.current.reset()
    samplesRef.current = []
    modelRef.current = null
    lastRecordedFrameTsRef.current = 0
  }, [])

  useEffect(() => {
    return () => { stop() }
  }, [stop])

  return {
    isReady,
    faceDetected,
    prediction,
    error,
    start,
    stop,
    recordCalibrationSample,
    exportModel,
    loadModel,
    getPrediction,
    resetCalibration,
  }
}
