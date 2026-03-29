import React, { useState, useEffect, useRef } from 'react'

interface FaceCheckStepProps {
  faceDetected: boolean
  onNext: () => void
}

export function FaceCheckStep({ faceDetected, onNext }: FaceCheckStepProps) {
  const [countdown, setCountdown] = useState(2)
  const [ready, setReady] = useState(false)
  const holdStartRef = useRef<number | null>(null)

  useEffect(() => {
    if (ready) return

    if (faceDetected) {
      if (holdStartRef.current === null) {
        holdStartRef.current = Date.now()
      }

      const id = setInterval(() => {
        const elapsed = Date.now() - (holdStartRef.current ?? Date.now())
        const remaining = Math.max(0, 2 - Math.floor(elapsed / 1000))
        setCountdown(remaining)

        if (remaining === 0) {
          clearInterval(id)
          setReady(true)
        }
      }, 200)

      return () => clearInterval(id)
    } else {
      holdStartRef.current = null
      setCountdown(2)
    }
  }, [faceDetected, ready])

  useEffect(() => {
    if (ready) {
      const timeout = setTimeout(onNext, 800)
      return () => clearTimeout(timeout)
    }
    return undefined
  }, [ready, onNext])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8">
      <h1 className="text-2xl font-bold text-gray-900">Face Check</h1>

      {ready ? (
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-green-100">
            <svg className="h-12 w-12 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-lg font-medium text-green-600">Ready!</p>
        </div>
      ) : faceDetected ? (
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-indigo-300 bg-indigo-50">
            <span className="text-4xl font-bold text-indigo-600">
              {countdown}
            </span>
          </div>
          <p className="text-sm text-gray-500">Hold still...</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-dashed border-gray-300 bg-gray-50">
            <svg className="h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
          <p className="text-sm text-gray-500">
            Please look at the screen and keep your face visible
          </p>
        </div>
      )}
    </div>
  )
}
