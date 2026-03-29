import React, { useState, useCallback } from 'react'
import { CALIBRATION_POINTS } from '@gazekit/shared'
import { CalibrationDot } from '../components/CalibrationDot'
import { ProgressBar } from '../components/ProgressBar'

interface CalibrationStepProps {
  onComplete: () => void
  onRecordSample: (x: number, y: number) => void
  prediction: { x: number; y: number } | null
}

export function CalibrationStep({ onComplete, onRecordSample, prediction }: CalibrationStepProps) {
  const [currentPointIndex, setCurrentPointIndex] = useState(0)
  const totalPoints = CALIBRATION_POINTS.length

  const handlePointComplete = useCallback(() => {
    const nextIndex = currentPointIndex + 1
    if (nextIndex >= totalPoints) {
      onComplete()
    } else {
      setCurrentPointIndex(nextIndex)
    }
  }, [currentPointIndex, totalPoints, onComplete])

  return (
    <div className="relative h-screen w-screen bg-white">
      {/* Live gaze dot */}
      {prediction && (
        <div
          className="pointer-events-none fixed z-[99998] rounded-full border-2 border-red-400 bg-red-500/40"
          style={{
            left: prediction.x - 10,
            top: prediction.y - 10,
            width: 20,
            height: 20,
            transition: 'left 0.08s linear, top 0.08s linear',
          }}
        />
      )}

      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-center px-4 pt-4">
        <p className="rounded-lg bg-gray-100/90 px-5 py-2.5 text-sm text-gray-700 shadow-sm backdrop-blur">
          <span className="font-semibold">Stare at each dot</span> as it appears and shrinks. No clicking needed — just keep your eyes on it.
        </p>
      </div>

      {CALIBRATION_POINTS.map((point, index) => (
        <CalibrationDot
          key={`${point.x}-${point.y}`}
          position={point}
          onComplete={handlePointComplete}
          onRecordSample={onRecordSample}
          active={index === currentPointIndex}
        />
      ))}

      <div className="absolute bottom-0 left-0 right-0 z-10 px-8 pb-6">
        <ProgressBar
          current={currentPointIndex + 1}
          total={totalPoints}
          label={`Point ${currentPointIndex + 1}/${totalPoints}`}
        />
      </div>
    </div>
  )
}
