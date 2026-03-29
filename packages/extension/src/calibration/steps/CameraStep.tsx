import React, { useState, useEffect, useRef, useCallback } from 'react'
import { FaceGuide } from '../components/FaceGuide'

interface CameraStepProps {
  onNext: (stream: MediaStream) => void
  onFaceDetected: (detected: boolean) => void
}

export function CameraStep({ onNext, onFaceDetected }: CameraStepProps) {
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
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
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
