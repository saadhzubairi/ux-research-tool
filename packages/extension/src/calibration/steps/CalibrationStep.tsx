import React, { useState, useCallback } from 'react'
import { CALIBRATION_POINTS } from '@gazekit/shared'
import { CalibrationDot } from '../components/CalibrationDot'
import { ProgressBar } from '../components/ProgressBar'

interface CalibrationStepProps {
  onComplete: () => void
  /** Returns true when the sample passed quality filtering */
  onRecordSample: (x: number, y: number, pointId: string) => boolean
}

const MAX_RETRIES_PER_POINT = 1

interface QueueEntry {
  point: { x: number; y: number }
  attempt: number
}

// No live gaze dot here on purpose: rendering the model's prediction during
// recording pulls the user's eyes off the target and bakes the previous
// model's error into the new fit.
export function CalibrationStep({ onComplete, onRecordSample }: CalibrationStepProps) {
  const [queue, setQueue] = useState<QueueEntry[]>(() =>
    CALIBRATION_POINTS.map((point) => ({ point, attempt: 0 })),
  )
  const [queueIndex, setQueueIndex] = useState(0)
  const [completedPoints, setCompletedPoints] = useState<Array<{ x: number; y: number }>>([])

  const totalPoints = CALIBRATION_POINTS.length
  const current = queue[queueIndex]

  const handlePointComplete = useCallback(
    (accepted: boolean) => {
      const entry = queue[queueIndex]
      if (!entry) return
      let nextQueue = queue

      if (accepted) {
        setCompletedPoints((prev) => [...prev, entry.point])
      } else if (entry.attempt < MAX_RETRIES_PER_POINT) {
        // Too many blinks / face lost — retry this point at the end
        nextQueue = [...queue, { point: entry.point, attempt: entry.attempt + 1 }]
        setQueue(nextQueue)
      }

      const nextIndex = queueIndex + 1
      if (nextIndex >= nextQueue.length) {
        onComplete()
      } else {
        setQueueIndex(nextIndex)
      }
    },
    [queue, queueIndex, onComplete],
  )

  return (
    <div className="relative h-screen w-screen bg-white">
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-center px-4 pt-4">
        <p className="rounded-lg bg-gray-100/90 px-5 py-2.5 text-sm text-gray-700 shadow-sm backdrop-blur">
          <span className="font-semibold">Keep your head still</span> and follow the dot with
          your eyes only. Try not to blink while it&apos;s shrinking.
        </p>
      </div>

      {/* Completed points as subtle checkmarks */}
      {completedPoints.map((point, i) => (
        <div
          key={`done-${i}`}
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-green-500/40"
          style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
        />
      ))}

      {current && (
        <CalibrationDot
          key={`${current.point.x}-${current.point.y}-${current.attempt}`}
          position={current.point}
          onComplete={handlePointComplete}
          onRecordSample={(x, y) =>
            onRecordSample(x, y, `${current.point.x}:${current.point.y}`)
          }
          active
        />
      )}

      <div className="absolute bottom-0 left-0 right-0 z-10 px-8 pb-6">
        <ProgressBar
          current={Math.min(queueIndex + 1, queue.length)}
          total={queue.length}
          label={`Point ${Math.min(queueIndex + 1, queue.length)}/${queue.length}${queue.length > totalPoints ? ' (retrying)' : ''}`}
        />
      </div>
    </div>
  )
}
