// packages/extension/src/offscreen/faceLandmarker.ts
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import {
  extractFrameFeatures,
  LANDMARK_COUNT_REQUIRED,
  type FrameFeatures,
} from './features'

let faceLandmarker: FaceLandmarker | null = null
let lastVideoTimestampMs = -1

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
    // The eyeLook* blendshapes are a learned, roughly head-normalized
    // re-encoding of eye rotation — auxiliary features for the regression
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: false,
  })
  lastVideoTimestampMs = -1
}

export interface GazeFrameResult {
  faceDetected: boolean
  frame: FrameFeatures | null
}

const NO_FACE: GazeFrameResult = { faceDetected: false, frame: null }

/** Run face landmark detection on a video frame and extract gaze features. */
export function detectGazeFrame(
  video: HTMLVideoElement,
  timestampMs: number,
): GazeFrameResult {
  if (!faceLandmarker) return NO_FACE

  // detectForVideo requires strictly increasing timestamps
  const ts = timestampMs <= lastVideoTimestampMs ? lastVideoTimestampMs + 1 : timestampMs
  lastVideoTimestampMs = ts

  const result = faceLandmarker.detectForVideo(video, ts)

  if (!result.faceLandmarks || result.faceLandmarks.length === 0) return NO_FACE

  const landmarks = result.faceLandmarks[0]
  if (!landmarks || landmarks.length < LANDMARK_COUNT_REQUIRED) {
    return { faceDetected: true, frame: null }
  }

  const blendshapes = new Map<string, number>()
  const categories = result.faceBlendshapes?.[0]?.categories
  if (categories) {
    for (const c of categories) blendshapes.set(c.categoryName, c.score)
  }

  const frame = extractFrameFeatures(landmarks, blendshapes)
  return { faceDetected: true, frame }
}

/** Clean up MediaPipe resources. */
export function closeFaceLandmarker(): void {
  faceLandmarker?.close()
  faceLandmarker = null
  lastVideoTimestampMs = -1
}
