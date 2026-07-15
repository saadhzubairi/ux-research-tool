import React, { useState, useCallback, useRef, useEffect } from 'react'
import {
  CALIBRATION_QUALITY,
  CALIBRATION_QUALITY_DEG,
  derivePhysicalScreen,
} from '@gazekit/shared'
import { modelPxPerDeg, type GazeModel } from '../offscreen/regression'
import { useMediaPipe } from './hooks/useMediaPipe'
import { VideoPreview } from './components/VideoPreview'
import { CameraStep } from './steps/CameraStep'
import { FaceCheckStep } from './steps/FaceCheckStep'
import { CalibrationStep } from './steps/CalibrationStep'
import { ValidationStep, type ValidationResult } from './steps/ValidationStep'
import { ResultsStep } from './steps/ResultsStep'
import { TabPickerStep } from './steps/TabPickerStep'

type CalibrationStage =
  | 'camera'
  | 'face-check'
  | 'calibration'
  | 'validation'
  | 'results'
  | 'tab-picker'

export type CalibrationQualityTier = 'good' | 'usable' | 'poor'

export function qualityTier(
  result: ValidationResult,
  pxPerDeg?: number | null,
): CalibrationQualityTier {
  if (!Number.isFinite(result.medianErrorPx) || result.sampleCoverage < 0.5) {
    return 'poor'
  }
  // With physical screen info, gate on visual degrees — the same angular
  // accuracy should pass on a 13" laptop and a 27" monitor alike.
  if (typeof pxPerDeg === 'number' && Number.isFinite(pxPerDeg) && pxPerDeg > 0) {
    const errDeg = result.medianErrorPx / pxPerDeg
    if (errDeg > CALIBRATION_QUALITY_DEG.USABLE_MEDIAN_DEG) return 'poor'
    if (errDeg > CALIBRATION_QUALITY_DEG.GOOD_MEDIAN_DEG) return 'usable'
    return 'good'
  }
  const diag = Math.hypot(window.innerWidth, window.innerHeight)
  if (result.medianErrorPx > CALIBRATION_QUALITY.USABLE_DIAG_FRACTION * diag) {
    return 'poor'
  }
  if (result.medianErrorPx > CALIBRATION_QUALITY.GOOD_DIAG_FRACTION * diag) {
    return 'usable'
  }
  return 'good'
}

export function CalibrationApp() {
  const [stage, setStage] = useState<CalibrationStage>('camera')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [tier, setTier] = useState<CalibrationQualityTier>('poor')
  const [modelSaved, setModelSaved] = useState(false)
  const [fitError, setFitError] = useState<string | null>(null)
  const faceDetectedRef = useRef(false)
  const modelRef = useRef<GazeModel | null>(null)
  const mediapipe = useMediaPipe()

  // Physical screen diagonal (inches) — optional, remembered across
  // calibrations. Ref mirror keeps stage callbacks stable.
  const [screenDiagonalIn, setScreenDiagonalIn] = useState<number | null>(null)
  const screenDiagonalRef = useRef<number | null>(null)

  useEffect(() => {
    chrome.storage.local.get('gazekit:screenDiagonalIn').then((stored) => {
      const v = stored['gazekit:screenDiagonalIn'] as unknown
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        setScreenDiagonalIn(v)
        screenDiagonalRef.current = v
      }
    })
  }, [])

  const handleScreenDiagonalChange = useCallback((inches: number | null) => {
    setScreenDiagonalIn(inches)
    screenDiagonalRef.current = inches
    if (inches !== null) {
      void chrome.storage.local.set({ 'gazekit:screenDiagonalIn': inches })
    } else {
      void chrome.storage.local.remove('gazekit:screenDiagonalIn')
    }
  }, [])

  const handleCameraNext = useCallback(
    async (mediaStream: MediaStream) => {
      // Pass existing stream — useMediaPipe reuses it for frame capture
      await mediapipe.start(mediaStream)
      setStream(mediaStream)
      setStage('face-check')
    },
    [mediapipe]
  )

  const handleFaceDetected = useCallback((detected: boolean) => {
    faceDetectedRef.current = detected
  }, [])

  const handleFaceCheckNext = useCallback(() => {
    setFitError(null)
    setStage('calibration')
  }, [])

  // Refs keep hook functions accessible without making callbacks unstable
  const exportModelRef = useRef(mediapipe.exportModel)
  exportModelRef.current = mediapipe.exportModel
  const resetCalibrationRef = useRef(mediapipe.resetCalibration)
  resetCalibrationRef.current = mediapipe.resetCalibration

  const handleCalibrationComplete = useCallback(() => {
    // Fit the model NOW — validation needs live predictions
    try {
      const model = exportModelRef.current()
      // refInterocular (median inter-ocular distance across calibration
      // frames) doubles as the viewing-distance estimate input
      const diagonal = screenDiagonalRef.current
      model.physical = diagonal
        ? derivePhysicalScreen(
            window.screen.width,
            window.screen.height,
            diagonal,
            model.refInterocular,
          )
        : null
      modelRef.current = model
      setFitError(null)
      setStage('validation')
    } catch (err) {
      // Degenerate fit (too many failed points / no variation) — recalibrate
      const message = err instanceof Error ? err.message : String(err)
      console.error('[GazeKit] Calibration fit failed:', message)
      setFitError(
        'Calibration failed: not enough clean samples were collected. ' +
          'Make sure your face stays visible and well-lit, then try again.',
      )
      resetCalibrationRef.current()
      setStage('face-check')
    }
  }, [])

  const handleRecordSample = useCallback(
    (x: number, y: number, pointId: string): boolean =>
      mediapipe.recordScreenPosition(x, y, pointId),
    [mediapipe]
  )

  const handleValidationComplete = useCallback(async (result: ValidationResult) => {
    setValidation(result)
    const resultTier = qualityTier(result, modelPxPerDeg(modelRef.current))
    setTier(resultTier)

    // Persist ONLY calibrations that passed the quality gate — a session run
    // on a model with known-bad validation produces worthless heatmaps.
    const model = modelRef.current
    let saved = false
    if (model && resultTier !== 'poor') {
      const withValidation: GazeModel = {
        ...model,
        validation: {
          medianErrorPx: result.medianErrorPx,
          p95ErrorPx: result.p95ErrorPx,
          precisionPx: result.precisionPx,
        },
      }
      try {
        await chrome.storage.local.set({ 'gazekit:model': withValidation })
        saved = true
      } catch (err) {
        console.error('[GazeKit] Failed to persist calibration model:', err)
        setFitError('The calibration could not be saved — please recalibrate.')
      }
    }
    setModelSaved(saved)
    setStage('results')
  }, [])

  const handleRecalibrate = useCallback(() => {
    mediapipe.resetCalibration()
    setModelSaved(false)
    setValidation(null)
    setStage('calibration')
  }, [mediapipe])

  const handleStartTracking = useCallback(() => {
    setStage('tab-picker')
  }, [])

  const handleSelectTab = useCallback(async (tabId: number) => {
    await mediapipe.stop()
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      setStream(null)
    }
    chrome.runtime.sendMessage({ type: 'start_session', targetTabId: tabId })
    window.close()
  }, [mediapipe, stream])

  const stepIndicators: Array<{ key: CalibrationStage; label: string }> = [
    { key: 'camera', label: 'Camera' },
    { key: 'face-check', label: 'Face Check' },
    { key: 'calibration', label: 'Calibrate' },
    { key: 'validation', label: 'Validate' },
    { key: 'results', label: 'Results' },
    { key: 'tab-picker', label: 'Pick Tab' },
  ]

  const stageOrder: CalibrationStage[] = [
    'camera',
    'face-check',
    'calibration',
    'validation',
    'results',
    'tab-picker',
  ]
  const currentStageIndex = stageOrder.indexOf(stage)

  const showChrome = stage !== 'calibration' && stage !== 'validation' && stage !== 'tab-picker'

  return (
    <div className="flex h-screen w-screen flex-col bg-gray-50">
      {/* Eye tracking error banner */}
      {mediapipe.error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-center">
          <p className="text-sm font-medium text-red-700">Eye Tracking Error</p>
          <p className="mt-1 text-xs text-red-600">{mediapipe.error}</p>
        </div>
      )}

      {/* Calibration fit failure banner */}
      {fitError && stage !== 'calibration' && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-center">
          <p className="text-sm font-medium text-amber-800">Calibration Needs Another Try</p>
          <p className="mt-1 text-xs text-amber-700">{fitError}</p>
        </div>
      )}

      {showChrome && (
        <div className="flex items-center justify-center gap-1 border-b border-gray-200 px-4 py-4">
          {stepIndicators.map((step, index) => {
            const isActive = step.key === stage
            const isCompleted = index < currentStageIndex

            return (
              <React.Fragment key={step.key}>
                {index > 0 && (
                  <div
                    className={`h-px w-8 ${
                      isCompleted ? 'bg-indigo-500' : 'bg-gray-300'
                    }`}
                  />
                )}
                <div className="flex items-center gap-1.5">
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                      isCompleted
                        ? 'bg-indigo-500 text-white'
                        : isActive
                          ? 'border-2 border-indigo-500 text-indigo-600'
                          : 'border border-gray-300 text-gray-400'
                    }`}
                  >
                    {isCompleted ? (
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      index + 1
                    )}
                  </div>
                  <span
                    className={`hidden text-xs sm:inline ${
                      isActive ? 'text-indigo-600' : 'text-gray-400'
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
              </React.Fragment>
            )
          })}
        </div>
      )}

      <div className="relative flex-1">
        {stage === 'camera' && (
          <CameraStep
            onNext={handleCameraNext}
            onFaceDetected={handleFaceDetected}
            screenDiagonalIn={screenDiagonalIn}
            onScreenDiagonalChange={handleScreenDiagonalChange}
          />
        )}
        {stage === 'face-check' && (
          <FaceCheckStep faceDetected={mediapipe.faceDetected} onNext={handleFaceCheckNext} />
        )}
        {stage === 'calibration' && (
          <CalibrationStep onComplete={handleCalibrationComplete} onRecordSample={handleRecordSample} />
        )}
        {stage === 'validation' && (
          <ValidationStep
            getPrediction={mediapipe.getPrediction}
            prediction={mediapipe.prediction}
            faceDetected={mediapipe.faceDetected}
            onComplete={handleValidationComplete}
          />
        )}
        {stage === 'results' && validation && (
          <ResultsStep
            validation={validation}
            tier={tier}
            modelSaved={modelSaved}
            physical={modelRef.current?.physical ?? null}
            onRecalibrate={handleRecalibrate}
            onStartTracking={handleStartTracking}
          />
        )}
        {stage === 'tab-picker' && (
          <TabPickerStep onSelectTab={handleSelectTab} />
        )}
      </div>

      {stream && stage !== 'calibration' && stage !== 'validation' && (
        <VideoPreview stream={stream} faceDetected={mediapipe.faceDetected || faceDetectedRef.current} />
      )}

      {/* Compact status bar — bottom-left */}
      {mediapipe.isReady !== undefined && stage !== 'camera' && (
        <div className="pointer-events-none fixed bottom-4 left-4 z-[100000] flex items-center gap-3 rounded-lg border border-gray-200 bg-white/90 px-3 py-2 font-mono text-xs shadow-sm backdrop-blur">
          <span className={`h-2 w-2 rounded-full ${mediapipe.isReady ? 'bg-green-500' : mediapipe.error ? 'bg-red-500' : 'bg-yellow-500 animate-pulse'}`} />
          <span className="text-gray-600">
            {mediapipe.error
              ? `Error: ${mediapipe.error}`
              : !mediapipe.isReady
                ? 'Loading eye tracker...'
                : mediapipe.prediction
                  ? `Eyes: (${mediapipe.prediction.x.toFixed(0)}, ${mediapipe.prediction.y.toFixed(0)})`
                  : mediapipe.faceDetected
                    ? 'Face detected'
                    : 'Face not detected'}
          </span>
        </div>
      )}
    </div>
  )
}
