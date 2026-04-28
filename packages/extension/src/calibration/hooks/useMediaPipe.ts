// packages/extension/src/calibration/hooks/useMediaPipe.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  initFaceLandmarker,
  detectGaze,
  closeFaceLandmarker,
} from '../../offscreen/faceLandmarker'
import { solvePolynomial, predictGaze, type CalibrationSample, type PolynomialModel } from '../../offscreen/polynomial'

export interface UseMediaPipeReturn {
  isReady: boolean
  faceDetected: boolean
  prediction: { x: number; y: number } | null
  error: string | null
  start: (stream: MediaStream) => Promise<void>
  stop: () => void
  recordScreenPosition: (x: number, y: number) => void
  exportModel: () => Promise<PolynomialModel | null>
  getPrediction: () => { x: number; y: number } | null
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
  const normalizedIrisRef = useRef<{ x: number; y: number } | null>(null)
  const samplesRef = useRef<CalibrationSample[]>([])
  const modelRef = useRef<PolynomialModel | null>(null)

  const start = useCallback(async (stream: MediaStream) => {
    try {
      streamRef.current = stream

      // Create hidden video element
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
      videoRef.current = video

      // Initialize MediaPipe
      const wasmPath = chrome.runtime.getURL('mediapipe/wasm')
      const modelPath = chrome.runtime.getURL('mediapipe/models/face_landmarker.task')
      await initFaceLandmarker(wasmPath, modelPath)

      setIsReady(true)

      // Start prediction loop
      const loop = () => {
        if (!videoRef.current || videoRef.current.readyState < 2) {
          rafRef.current = requestAnimationFrame(loop)
          return
        }

        const raw = detectGaze(videoRef.current, performance.now())
        setFaceDetected(raw.faceDetected)

        if (raw.normalizedIris) {
          normalizedIrisRef.current = raw.normalizedIris

          if (modelRef.current) {
            const pred = predictGaze(modelRef.current, raw.normalizedIris.x, raw.normalizedIris.y)
            predictionRef.current = pred
            setPrediction(pred)
          }
        }

        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const recordScreenPosition = useCallback((x: number, y: number) => {
    // Use the latest iris data from the prediction loop — do NOT call detectGaze()
    // again, as running two concurrent MediaPipe inferences causes severe lag.
    const iris = normalizedIrisRef.current
    if (iris) {
      samplesRef.current.push({
        irisX: iris.x,
        irisY: iris.y,
        screenX: x,
        screenY: y,
      })
    }
  }, [])

  const exportModel = useCallback(async (): Promise<PolynomialModel | null> => {
    if (samplesRef.current.length < 6) {
      console.warn('[useMediaPipe] Not enough samples to solve polynomial')
      return null
    }

    const model = solvePolynomial(samplesRef.current)
    modelRef.current = model
    return model
  }, [])

  const getPrediction = useCallback(() => predictionRef.current, [])

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
    getPrediction,
  }
}
