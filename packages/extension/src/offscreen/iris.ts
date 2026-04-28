export interface Landmark {
  x: number
  y: number
  z: number
}

export interface IrisData {
  leftIrisCenter: Landmark   // landmark 468
  rightIrisCenter: Landmark  // landmark 473
  leftInnerCorner: Landmark  // landmark 133
  leftOuterCorner: Landmark  // landmark 33
  rightInnerCorner: Landmark // landmark 362
  rightOuterCorner: Landmark // landmark 263
  leftUpperEyelid: Landmark  // landmark 159
  leftLowerEyelid: Landmark  // landmark 145
  rightUpperEyelid: Landmark // landmark 386
  rightLowerEyelid: Landmark // landmark 374
}

/**
 * Compute normalized iris position from face landmarks.
 *
 * Horizontal: iris center relative to eye corners (min/max for sign consistency).
 * Vertical: iris deviation from eye center, normalized by eye WIDTH (not eyelid
 * opening, which is too small — only ~2-3px at 640px — producing noisy values).
 * Both eyes averaged for stability.
 */
export function normalizeIrisPosition(data: IrisData): { x: number; y: number } {
  // Left eye
  const lMinX = Math.min(data.leftInnerCorner.x, data.leftOuterCorner.x)
  const lMaxX = Math.max(data.leftInnerCorner.x, data.leftOuterCorner.x)
  const lEyeWidth = lMaxX - lMinX
  const lTx = (data.leftIrisCenter.x - lMinX) / lEyeWidth
  const lEyeCenterY = (data.leftUpperEyelid.y + data.leftLowerEyelid.y) / 2
  const lTy = (data.leftIrisCenter.y - lEyeCenterY) / lEyeWidth

  // Right eye
  const rMinX = Math.min(data.rightInnerCorner.x, data.rightOuterCorner.x)
  const rMaxX = Math.max(data.rightInnerCorner.x, data.rightOuterCorner.x)
  const rEyeWidth = rMaxX - rMinX
  const rTx = (data.rightIrisCenter.x - rMinX) / rEyeWidth
  const rEyeCenterY = (data.rightUpperEyelid.y + data.rightLowerEyelid.y) / 2
  const rTy = (data.rightIrisCenter.y - rEyeCenterY) / rEyeWidth

  return {
    x: (lTx + rTx) / 2,
    y: (lTy + rTy) / 2,
  }
}

/** MediaPipe landmark indices used for iris tracking. */
export const IRIS_LANDMARKS = {
  leftIrisCenter: 468,
  rightIrisCenter: 473,
  leftInnerCorner: 133,
  leftOuterCorner: 33,
  rightInnerCorner: 362,
  rightOuterCorner: 263,
  leftUpperEyelid: 159,
  leftLowerEyelid: 145,
  rightUpperEyelid: 386,
  rightLowerEyelid: 374,
} as const

/** Extract IrisData from a MediaPipe NormalizedLandmark array (478 landmarks). */
export function extractIrisData(landmarks: Landmark[]): IrisData {
  const L = IRIS_LANDMARKS
  return {
    leftIrisCenter: landmarks[L.leftIrisCenter],
    rightIrisCenter: landmarks[L.rightIrisCenter],
    leftInnerCorner: landmarks[L.leftInnerCorner],
    leftOuterCorner: landmarks[L.leftOuterCorner],
    rightInnerCorner: landmarks[L.rightInnerCorner],
    rightOuterCorner: landmarks[L.rightOuterCorner],
    leftUpperEyelid: landmarks[L.leftUpperEyelid],
    leftLowerEyelid: landmarks[L.leftLowerEyelid],
    rightUpperEyelid: landmarks[L.rightUpperEyelid],
    rightLowerEyelid: landmarks[L.rightLowerEyelid],
  }
}
