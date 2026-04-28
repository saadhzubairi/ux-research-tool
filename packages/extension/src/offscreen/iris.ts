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
 *   This gives a 0–1 value that's invariant to head position.
 *
 * Vertical: raw average iris Y in image coordinates (0–1). We use the raw position
 *   because the iris barely moves vertically within the eye — the dominant vertical
 *   signal is HEAD TILT (looking down → head tilts → iris Y increases in camera).
 *   Normalizing by eyelid opening or eye width removes this crucial head-pose signal.
 *   The polynomial will learn to map raw iris Y → screen Y for each calibration session.
 */
export function normalizeIrisPosition(data: IrisData): { x: number; y: number } {
  // Horizontal: normalized iris-in-eye position (good signal, head-invariant)
  const lMinX = Math.min(data.leftInnerCorner.x, data.leftOuterCorner.x)
  const lMaxX = Math.max(data.leftInnerCorner.x, data.leftOuterCorner.x)
  const lTx = (data.leftIrisCenter.x - lMinX) / (lMaxX - lMinX)

  const rMinX = Math.min(data.rightInnerCorner.x, data.rightOuterCorner.x)
  const rMaxX = Math.max(data.rightInnerCorner.x, data.rightOuterCorner.x)
  const rTx = (data.rightIrisCenter.x - rMinX) / (rMaxX - rMinX)

  // Vertical: raw iris Y in image coords (captures head tilt — the dominant signal)
  const avgIrisY = (data.leftIrisCenter.y + data.rightIrisCenter.y) / 2

  return {
    x: (lTx + rTx) / 2,
    y: avgIrisY,
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
