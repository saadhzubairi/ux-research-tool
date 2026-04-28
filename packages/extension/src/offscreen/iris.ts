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
 * Compute normalized iris position (0–1) from face landmarks.
 *
 * Horizontal: iris center relative to eye corners (min/max for sign consistency).
 * Vertical: iris center relative to upper/lower eyelids.
 * Both eyes averaged for stability.
 */
export function normalizeIrisPosition(data: IrisData): { x: number; y: number } {
  const lMinX = Math.min(data.leftInnerCorner.x, data.leftOuterCorner.x)
  const lMaxX = Math.max(data.leftInnerCorner.x, data.leftOuterCorner.x)
  const lTx = (data.leftIrisCenter.x - lMinX) / (lMaxX - lMinX)

  const lTy =
    (data.leftIrisCenter.y - data.leftUpperEyelid.y) /
    (data.leftLowerEyelid.y - data.leftUpperEyelid.y)

  const rMinX = Math.min(data.rightInnerCorner.x, data.rightOuterCorner.x)
  const rMaxX = Math.max(data.rightInnerCorner.x, data.rightOuterCorner.x)
  const rTx = (data.rightIrisCenter.x - rMinX) / (rMaxX - rMinX)

  const rTy =
    (data.rightIrisCenter.y - data.rightUpperEyelid.y) /
    (data.rightLowerEyelid.y - data.rightUpperEyelid.y)

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
