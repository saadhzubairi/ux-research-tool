import React, { useEffect, useRef, useState } from 'react'
import { ProgressBar } from '../components/ProgressBar'
import {
  buildPursuitTimeline,
  dotPositionAt,
  sampleAt,
  segmentAt,
  type PursuitTimeline,
  type SegmentKind,
} from '../pursuitPath'
import type { CalibrationSampleKind } from '../../offscreen/regression'

interface CalibrationStepProps {
  onComplete: () => void
  /** Returns true when the sample passed quality filtering */
  onRecordSample: (
    clientX: number,
    clientY: number,
    group: string,
    kind: CalibrationSampleKind,
  ) => boolean
  faceDetected: boolean
}

const INTRO_MS = 1800

interface DotState {
  x: number
  y: number
  kind: SegmentKind
  segmentId: string
  elapsedMs: number
}

// Smooth-pursuit calibration: ONE continuous ~20s animation instead of a
// grid of discrete targets. No live gaze dot here on purpose: rendering the
// model's prediction during recording pulls the user's eyes off the target
// and bakes the previous model's error into the new fit.
export function CalibrationStep({ onComplete, onRecordSample, faceDetected }: CalibrationStepProps) {
  const [phase, setPhase] = useState<'intro' | 'run'>('intro')
  const [dot, setDot] = useState<DotState | null>(null)
  const timelineRef = useRef<PursuitTimeline | null>(null)
  const rafRef = useRef(0)
  const startTsRef = useRef<number | null>(null)
  const completedRef = useRef(false)
  const acceptedCountRef = useRef(0)

  // Stable refs so the rAF loop never restarts from parent re-renders
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const onRecordSampleRef = useRef(onRecordSample)
  onRecordSampleRef.current = onRecordSample

  // Build the timeline once, for THIS viewport's aspect ratio
  if (timelineRef.current === null) {
    timelineRef.current = buildPursuitTimeline(window.innerWidth / window.innerHeight)
  }

  useEffect(() => {
    const timer = setTimeout(() => setPhase('run'), INTRO_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (phase !== 'run') return
    const timeline = timelineRef.current
    if (!timeline) return

    const tick = (now: number): void => {
      if (startTsRef.current === null) startTsRef.current = now
      const t = now - startTsRef.current

      if (t >= timeline.totalMs) {
        if (!completedRef.current) {
          completedRef.current = true
          onCompleteRef.current()
        }
        return
      }

      const pos = dotPositionAt(timeline, t)
      const seg = segmentAt(timeline, t)
      setDot({
        x: pos.x,
        y: pos.y,
        kind: seg?.kind ?? 'transit',
        segmentId: seg?.id ?? '',
        elapsedMs: t,
      })

      // Label the current camera frame with where the EYE is (pursuit-lagged
      // dot position). The hook dedups per camera frame internally.
      const spec = sampleAt(timeline, t)
      if (spec?.record) {
        const accepted = onRecordSampleRef.current(
          spec.x * window.innerWidth,
          spec.y * window.innerHeight,
          spec.group,
          spec.kind,
        )
        if (accepted) acceptedCountRef.current++
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [phase])

  const timeline = timelineRef.current
  const isVor = dot?.kind === 'vor'
  const vorAxis = dot?.segmentId === 'vor-ud' ? 'ud' : 'lr'
  const remainingS = timeline && dot ? Math.ceil((timeline.totalMs - dot.elapsedMs) / 1000) : null

  const instruction =
    phase === 'intro'
      ? 'Follow the dot with your eyes'
      : isVor
        ? vorAxis === 'lr'
          ? 'Keep your eyes ON the dot — slowly turn your head left and right'
          : 'Keep your eyes ON the dot — now slowly tilt your head up and down'
        : 'Keep your head still and follow the dot with your eyes only'

  const dotLeft = `${(dot?.x ?? 0.5) * 100}%`
  const dotTop = `${(dot?.y ?? 0.5) * 100}%`
  const isDwell = dot?.kind === 'dwell'

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-white">
      <style>{`
        @keyframes gk-sway-x {
          0%, 100% { transform: translate(-14px, 0); opacity: 0.9; }
          50% { transform: translate(14px, 0); opacity: 0.5; }
        }
        @keyframes gk-sway-y {
          0%, 100% { transform: translate(0, -14px); opacity: 0.9; }
          50% { transform: translate(0, 14px); opacity: 0.5; }
        }
      `}</style>

      {/* Instruction banner */}
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-center px-4 pt-4">
        <p
          className={`rounded-lg px-5 py-2.5 text-sm shadow-sm backdrop-blur transition-colors ${
            isVor ? 'bg-teal-50/95 text-teal-800' : 'bg-gray-100/90 text-gray-700'
          }`}
        >
          <span className="font-semibold">{instruction}</span>
        </p>
      </div>

      {/* Face-lost warning */}
      {phase === 'run' && !faceDetected && (
        <div className="absolute left-1/2 top-16 z-20 -translate-x-1/2 rounded-lg bg-red-50 px-4 py-2 text-sm font-medium text-red-700 shadow">
          Face not visible — sit back into view of the camera
        </div>
      )}

      {/* Intro overlay */}
      {phase === 'intro' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/80">
          <p className="text-xl font-semibold text-gray-800">Follow the dot with your eyes</p>
          <p className="text-sm text-gray-500">
            One smooth sweep, about 20 seconds. Keep your head still until asked to move it.
          </p>
        </div>
      )}

      {/* The pursuit dot */}
      <div
        className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
        style={{ left: dotLeft, top: dotTop }}
      >
        <div className="relative flex items-center justify-center">
          {/* Halo ring — tightens during dwells to cue precise fixation */}
          <span
            className={`absolute rounded-full border-2 transition-all duration-300 ${
              isVor ? 'border-teal-300/70' : 'border-indigo-300/60'
            }`}
            style={{
              width: isDwell || isVor ? 30 : 44,
              height: isDwell || isVor ? 30 : 44,
            }}
          />
          {/* Core */}
          <span
            className={`block rounded-full transition-colors duration-300 ${
              isVor ? 'bg-teal-500' : 'bg-indigo-600'
            }`}
            style={{ width: 14, height: 14 }}
          />

          {/* Head-turn hint arrows during the vor phase */}
          {isVor && (
            <>
              <span
                className="absolute select-none text-lg font-bold text-teal-600"
                style={{
                  animation: `${vorAxis === 'lr' ? 'gk-sway-x' : 'gk-sway-y'} 2.4s ease-in-out infinite`,
                  [vorAxis === 'lr' ? 'left' : 'top']: -56,
                } as React.CSSProperties}
              >
                {vorAxis === 'lr' ? '⟵' : '↑'}
              </span>
              <span
                className="absolute select-none text-lg font-bold text-teal-600"
                style={{
                  animation: `${vorAxis === 'lr' ? 'gk-sway-x' : 'gk-sway-y'} 2.4s ease-in-out infinite reverse`,
                  [vorAxis === 'lr' ? 'right' : 'bottom']: -56,
                } as React.CSSProperties}
              >
                {vorAxis === 'lr' ? '⟶' : '↓'}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Progress */}
      {timeline && (
        <div className="absolute bottom-0 left-0 right-0 z-10 px-8 pb-6">
          <ProgressBar
            current={dot?.elapsedMs ?? 0}
            total={timeline.totalMs}
            showCount={false}
            label={
              phase === 'intro'
                ? 'Get ready…'
                : remainingS !== null
                  ? `${isVor ? 'Head movement' : 'Following the dot'} — ${remainingS}s left`
                  : 'Calibrating…'
            }
          />
        </div>
      )}
    </div>
  )
}
