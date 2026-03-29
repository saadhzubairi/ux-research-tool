import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useWebGazer } from './hooks/useWebGazer'
import { VideoPreview } from './components/VideoPreview'
import { CameraStep } from './steps/CameraStep'
import { FaceCheckStep } from './steps/FaceCheckStep'
import { LibraryCheckStep } from './steps/LibraryCheckStep'
import { CalibrationStep } from './steps/CalibrationStep'
import { ValidationStep } from './steps/ValidationStep'
import { ResultsStep } from './steps/ResultsStep'
import { TabPickerStep } from './steps/TabPickerStep'

type CalibrationStage =
  | 'camera'
  | 'face-check'
  | 'library-check'
  | 'calibration'
  | 'validation'
  | 'results'
  | 'tab-picker'

export function CalibrationApp() {
  const [stage, setStage] = useState<CalibrationStage>('camera')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [avgErrorPx, setAvgErrorPx] = useState(0)
  const faceDetectedRef = useRef(false)
  const webgazer = useWebGazer()

  const handleCameraNext = useCallback(
    async (mediaStream: MediaStream) => {
      // Pass existing stream — useWebGazer reuses it for frame capture
      await webgazer.start(mediaStream)
      setStream(null)
      setStage('face-check')
    },
    [webgazer]
  )

  const handleFaceDetected = useCallback((detected: boolean) => {
    faceDetectedRef.current = detected
  }, [])

  const handleFaceCheckNext = useCallback(() => {
    setStage('library-check')
  }, [])

  const handleLibraryCheckNext = useCallback(() => {
    setStage('calibration')
  }, [])

  const handleCalibrationComplete = useCallback(() => {
    setStage('validation')
  }, [])

  const handleRecordSample = useCallback(
    (x: number, y: number) => {
      webgazer.recordScreenPosition(x, y)
    },
    [webgazer]
  )

  // Ref keeps exportModel accessible without making the callback unstable
  const exportModelRef = useRef(webgazer.exportModel)
  exportModelRef.current = webgazer.exportModel

  const handleValidationComplete = useCallback(async (error: number) => {
    setAvgErrorPx(error)
    // Export the trained regression model and save to storage
    // so the offscreen gaze engine can reuse it during tracking
    try {
      const modelData = await exportModelRef.current()
      if (modelData) {
        await chrome.storage.local.set({ 'gazekit:model': modelData })
        console.log('[GazeKit] Calibration model saved to storage')
      }
    } catch (err) {
      console.warn('[GazeKit] Failed to export calibration model:', err)
    }
    setStage('results')
  }, [])

  const handleRecalibrate = useCallback(() => {
    setStage('calibration')
  }, [])

  const handleStartTracking = useCallback(() => {
    setStage('tab-picker')
  }, [])

  const handleSelectTab = useCallback(async (tabId: number) => {
    await webgazer.stop()
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      setStream(null)
    }
    chrome.runtime.sendMessage({ type: 'start_session', targetTabId: tabId })
    window.close()
  }, [webgazer, stream])

  const stepIndicators: Array<{ key: CalibrationStage; label: string }> = [
    { key: 'camera', label: 'Camera' },
    { key: 'face-check', label: 'Face Check' },
    { key: 'library-check', label: 'Eye Track' },
    { key: 'calibration', label: 'Calibrate' },
    { key: 'validation', label: 'Validate' },
    { key: 'results', label: 'Results' },
    { key: 'tab-picker', label: 'Pick Tab' },
  ]

  const stageOrder: CalibrationStage[] = [
    'camera',
    'face-check',
    'library-check',
    'calibration',
    'validation',
    'results',
    'tab-picker',
  ]
  const currentStageIndex = stageOrder.indexOf(stage)

  // Set iframe preview mode based on stage
  useEffect(() => {
    if (stage === 'library-check') {
      webgazer.setPreviewMode('large')
    } else if (stage === 'calibration' || stage === 'validation' || stage === 'tab-picker') {
      webgazer.setPreviewMode('hidden')
    } else {
      webgazer.setPreviewMode('pip')
    }
  }, [stage, webgazer])

  const showChrome = stage !== 'calibration' && stage !== 'validation' && stage !== 'tab-picker'

  return (
    <div className="flex h-screen w-screen flex-col bg-gray-50">
      {/* WebGazer error banner */}
      {webgazer.error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-center">
          <p className="text-sm font-medium text-red-700">WebGazer Error</p>
          <p className="mt-1 text-xs text-red-600">{webgazer.error}</p>
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
          <CameraStep onNext={handleCameraNext} onFaceDetected={handleFaceDetected} />
        )}
        {stage === 'face-check' && (
          <FaceCheckStep faceDetected={webgazer.faceDetected || faceDetectedRef.current} onNext={handleFaceCheckNext} />
        )}
        {stage === 'library-check' && (
          <LibraryCheckStep
            isReady={webgazer.isReady}
            faceDetected={webgazer.faceDetected}
            prediction={webgazer.prediction}
            listenerCount={webgazer.listenerCount}
            error={webgazer.error}
            onNext={handleLibraryCheckNext}
          />
        )}
        {stage === 'calibration' && (
          <CalibrationStep onComplete={handleCalibrationComplete} onRecordSample={handleRecordSample} prediction={webgazer.prediction} />
        )}
        {stage === 'validation' && (
          <ValidationStep
            getPrediction={webgazer.getPrediction}
            prediction={webgazer.prediction}
            faceDetected={webgazer.faceDetected}
            listenerCount={webgazer.listenerCount}
            onComplete={handleValidationComplete}
          />
        )}
        {stage === 'results' && (
          <ResultsStep
            avgErrorPx={avgErrorPx}
            onRecalibrate={handleRecalibrate}
            onStartTracking={handleStartTracking}
          />
        )}
        {stage === 'tab-picker' && (
          <TabPickerStep onSelectTab={handleSelectTab} />
        )}
      </div>

      {stream && stage !== 'calibration' && stage !== 'validation' && (
        <VideoPreview stream={stream} faceDetected={webgazer.faceDetected || faceDetectedRef.current} />
      )}

      {/* Compact status bar — bottom-left */}
      {webgazer.isReady !== undefined && stage !== 'camera' && (
        <div className="pointer-events-none fixed bottom-4 left-4 z-[100000] flex items-center gap-3 rounded-lg border border-gray-200 bg-white/90 px-3 py-2 font-mono text-xs shadow-sm backdrop-blur">
          <span className={`h-2 w-2 rounded-full ${webgazer.isReady ? 'bg-green-500' : webgazer.error ? 'bg-red-500' : 'bg-yellow-500 animate-pulse'}`} />
          <span className="text-gray-600">
            {webgazer.error
              ? `Error: ${webgazer.error}`
              : !webgazer.isReady
                ? 'Loading WebGazer...'
                : webgazer.prediction
                  ? `Eyes: (${webgazer.prediction.x.toFixed(0)}, ${webgazer.prediction.y.toFixed(0)}) | ${webgazer.listenerCount} samples`
                  : webgazer.faceDetected
                    ? `Face detected | ${webgazer.listenerCount} samples`
                    : 'Face not detected'}
          </span>
        </div>
      )}
    </div>
  )
}
