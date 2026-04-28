// packages/extension/src/offscreen/faceLandmarker.ts
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { extractIrisData, normalizeIrisPosition, type IrisData } from './iris'

let faceLandmarker: FaceLandmarker | null = null

/** Initialize the MediaPipe FaceLandmarker with WASM from local extension files. */
export async function initFaceLandmarker(
  wasmPath: string,
  modelPath: string,
): Promise<void> {
  const vision = await FilesetResolver.forVisionTasks(wasmPath)
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: modelPath,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  })
}

export interface GazePredictionRaw {
  faceDetected: boolean
  irisData: IrisData | null
  normalizedIris: { x: number; y: number } | null
}

/** Run face landmark detection on a video frame and extract iris data. */
export function detectGaze(
  video: HTMLVideoElement,
  timestampMs: number,
): GazePredictionRaw {
  if (!faceLandmarker) {
    return { faceDetected: false, irisData: null, normalizedIris: null }
  }

  const result = faceLandmarker.detectForVideo(video, timestampMs)

  if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
    return { faceDetected: false, irisData: null, normalizedIris: null }
  }

  const landmarks = result.faceLandmarks[0]
  if (landmarks.length < 478) {
    // No iris landmarks available
    return { faceDetected: true, irisData: null, normalizedIris: null }
  }

  const irisData = extractIrisData(landmarks)
  const normalizedIris = normalizeIrisPosition(irisData)

  return { faceDetected: true, irisData, normalizedIris }
}

/** Clean up MediaPipe resources. */
export function closeFaceLandmarker(): void {
  faceLandmarker?.close()
  faceLandmarker = null
}
