import React, { useState, useEffect, useRef, useCallback } from 'react'
import { FaceGuide } from '../components/FaceGuide'

interface CameraStepProps {
  onNext: (stream: MediaStream) => void
  onFaceDetected: (detected: boolean) => void
  /** Physical screen diagonal in inches, or null when unknown/skipped */
  screenDiagonalIn: number | null
  onScreenDiagonalChange: (inches: number | null) => void
}

const DIAGONAL_PRESETS = [13.3, 14, 16, 24, 27]

export function CameraStep({
  onNext,
  onFaceDetected,
  screenDiagonalIn,
  onScreenDiagonalChange,
}: CameraStepProps) {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [faceDetected, setFaceDetected] = useState(false)
  const [faceCentered, setFaceCentered] = useState(false)
  const [goodLighting, setGoodLighting] = useState(false)
  const [appropriateDistance, setAppropriateDistance] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const analyzeFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return

    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx || video.readyState < 2) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    ctx.drawImage(video, 0, 0)

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data

    let totalBrightness = 0
    let skinPixels = 0
    const totalPixels = data.length / 4

    for (let i = 0; i < data.length; i += 16) {
      const r = data[i] ?? 0
      const g = data[i + 1] ?? 0
      const b = data[i + 2] ?? 0
      totalBrightness += (r + g + b) / 3

      if (r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15) {
        skinPixels++
      }
    }

    const avgBrightness = totalBrightness / (totalPixels / 4)
    const skinRatio = skinPixels / (totalPixels / 4)

    const hasFace = skinRatio > 0.05
    const isCentered = skinRatio > 0.05 && skinRatio < 0.7
    const hasGoodLight = avgBrightness > 30 && avgBrightness < 240
    const hasGoodDistance = skinRatio > 0.05 && skinRatio < 0.55

    setFaceDetected(hasFace)
    setFaceCentered(isCentered)
    setGoodLighting(hasGoodLight)
    setAppropriateDistance(hasGoodDistance)
    onFaceDetected(hasFace)
  }, [onFaceDetected])

  useEffect(() => {
    const requestCamera = async () => {
      try {
        // MUST match the session engine's constraints (offscreen.ts) — the
        // gaze features come from frame-normalized landmarks, so a different
        // capture aspect ratio shifts the whole feature space between fit
        // and predict
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
            facingMode: 'user',
          },
        })
        setStream(mediaStream)
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream
        }
      } catch {
        setError(
          'Camera access denied. Please allow camera access in Chrome settings (chrome://settings/content/camera) and reload this page.'
        )
      }
    }

    requestCamera()

    return () => {
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current)
    }
  }, [])

  useEffect(() => {
    if (stream && videoRef.current) {
      checkIntervalRef.current = setInterval(analyzeFrame, 500)
    }
    return () => {
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current)
    }
  }, [stream, analyzeFrame])

  const allChecks = faceDetected && faceCentered && goodLighting && appropriateDistance

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md rounded-xl border border-red-200 bg-red-50 p-8 text-center">
          <svg className="mx-auto mb-4 h-12 w-12 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
          </svg>
          <h2 className="mb-2 text-lg font-semibold text-red-700">Camera Access Required</h2>
          <p className="text-sm text-gray-600">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8">
      <div>
        <h1 className="text-center text-2xl font-bold text-gray-900">
          Camera Setup
        </h1>
        <p className="mt-2 text-center text-sm text-gray-500">
          Position your face for accurate eye tracking
        </p>
      </div>

      <div className="relative">
        <div className={`overflow-hidden rounded-2xl border-2 transition-colors ${
          allChecks ? 'border-green-500' : 'border-gray-300'
        }`}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-[300px] w-[400px] -scale-x-100 object-cover"
          />
        </div>
        <canvas ref={canvasRef} className="hidden" />
      </div>

      <FaceGuide
        faceDetected={faceDetected}
        faceCentered={faceCentered}
        goodLighting={goodLighting}
        appropriateDistance={appropriateDistance}
      />

      <div className="w-[400px] rounded-xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-medium text-gray-700">Screen size (diagonal)</p>
        <p className="mt-0.5 text-xs text-gray-500">
          Optional — lets ismap measure accuracy in visual degrees instead of raw pixels.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {DIAGONAL_PRESETS.map((preset) => (
            <button
              key={preset}
              onClick={() =>
                onScreenDiagonalChange(screenDiagonalIn === preset ? null : preset)
              }
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                screenDiagonalIn === preset
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {preset}&Prime;
            </button>
          ))}
          <input
            type="number"
            min={5}
            max={100}
            step={0.1}
            value={
              screenDiagonalIn !== null && !DIAGONAL_PRESETS.includes(screenDiagonalIn)
                ? screenDiagonalIn
                : ''
            }
            onChange={(e) => {
              const v = e.target.valueAsNumber
              onScreenDiagonalChange(Number.isFinite(v) && v > 0 ? v : null)
            }}
            placeholder="Custom"
            className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-xs text-gray-700 focus:border-indigo-500 focus:outline-none"
          />
        </div>
      </div>

      <button
        onClick={() => stream && onNext(stream)}
        disabled={!allChecks}
        className="rounded-xl bg-indigo-600 px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 active:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next
      </button>
    </div>
  )
}
