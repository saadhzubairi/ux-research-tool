import React, { useRef, useEffect } from 'react'

interface VideoPreviewProps {
  stream: MediaStream | null
  faceDetected: boolean
}

export function VideoPreview({ stream, faceDetected }: VideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  if (!stream) return null

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div
        className={`relative overflow-hidden rounded-xl border-2 shadow-lg transition-colors ${
          faceDetected ? 'border-green-500' : 'border-red-500'
        }`}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-[120px] w-[160px] -scale-x-100 object-cover"
        />
        <div className="absolute bottom-1 left-1 flex items-center gap-1 rounded bg-white/80 px-1.5 py-0.5 shadow-sm">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              faceDetected ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span className="text-[10px] text-gray-700">
            {faceDetected ? 'Face OK' : 'No face'}
          </span>
        </div>
      </div>
    </div>
  )
}
