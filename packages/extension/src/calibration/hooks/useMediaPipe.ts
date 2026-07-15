// packages/extension/src/calibration/hooks/useMediaPipe.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  initFaceLandmarker,
  detectGazeFrame,
  closeFaceLandmarker,
} from '../../offscreen/faceLandmarker'
import { BlinkDetector, FEATURE_INDEX, type FrameFeatures } from '../../offscreen/features'
import {
  fitGazeModel,
  predictScreenPx,
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
   * Record one calibration sample for the target `pointId` shown at
   * (clientX, clientY). Returns true when a fresh, blink-free, face-detected
   * frame was captured.
   */
  recordScreenPosition: (clientX: number, clientY: number, pointId: string) => boolean
  /** Fit + persistable model. Throws with a user-facing message on failure. */
  exportModel: () => GazeModel
  /** Inject a stored model (playground / re-validation). */
  loadModel: (model: GazeModel) => void
  /** Fresh prediction in client px, or null if stale (blink/face lost). */
  getPrediction: () => { x: number; y: number } | null
  resetCalibration: () => void
}

interface RecordedSample {
  pointId: string
  screenX: number
  screenY: number
  features: number[]
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

  const recordScreenPosition = useCallback(
    (clientX: number, clientY: number, pointId: string): boolean => {
      // Use the latest frame from the prediction loop — do NOT call detectGazeFrame()
      // again, as running two concurrent MediaPipe inferences causes severe lag.
      const latest = latestFrameRef.current
      if (!latest) return false
      if (latest.blinking) return false
      if (performance.now() - latest.ts > SAMPLE_FRESHNESS_MS) return false

      const geometry = captureWindowGeometry(window, zoomRef.current)
      const screen = clientToScreen(geometry, clientX, clientY)
      samplesRef.current.push({
        pointId,
        screenX: screen.x,
        screenY: screen.y,
        features: [...latest.frame.features],
      })
      return true
    },
    [],
  )

  const exportModel = useCallback((): GazeModel => {
    // Group samples by their calibration point id (NOT by rounded screen
    // coords — a window nudge mid-calibration must not fragment a point)
    const byPoint = new Map<string, RecordedSample[]>()
    for (const s of samplesRef.current) {
      const arr = byPoint.get(s.pointId)
      if (arr) {
        arr.push(s)
      } else {
        byPoint.set(s.pointId, [s])
      }
    }

    // Per point, the label is the median recorded screen position — robust
    // if the window moved between samples
    const points = [...byPoint.values()].map((samples) => ({
      screenX: median(samples.map((s) => s.screenX)),
      screenY: median(samples.map((s) => s.screenY)),
      samples: samples.map((s) => s.features),
    }))

    const fit = fitGazeModel(points)

    // Clamp box for runtime predictions, anchored to where calibration
    // actually happened on the (possibly multi-monitor) desktop
    const calibBounds = {
      left: Math.min(...points.map((p) => p.screenX)),
      top: Math.min(...points.map((p) => p.screenY)),
      right: Math.max(...points.map((p) => p.screenX)),
      bottom: Math.max(...points.map((p) => p.screenY)),
    }

    // Reference head state = median over all recorded samples
    const all = samplesRef.current
    const featAt = (s: RecordedSample, i: number): number => s.features[i] as number
    const refHeadPose = {
      yaw: median(all.map((s) => featAt(s, FEATURE_INDEX.yaw))),
      pitch: median(all.map((s) => featAt(s, FEATURE_INDEX.pitch))),
      roll: median(all.map((s) => featAt(s, FEATURE_INDEX.roll))),
    }
    const refInterocular = median(all.map((s) => featAt(s, FEATURE_INDEX.interocular)))

    const model: GazeModel = {
      version: 2,
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
    recordScreenPosition,
    exportModel,
    loadModel,
    getPrediction,
    resetCalibration,
  }
}
