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
  noseTip: Landmark          // landmark 1
  forehead: Landmark         // landmark 10
}

/**
 * Compute normalized iris position from face landmarks.
 *
 * Horizontal: iris center relative to eye corners — good signal, head-invariant.
 *
 * Vertical: nose tip Y relative to forehead, normalized by face height.
 *   The nose tip swings through a much larger arc than the iris when the head
 *   tilts (looking down → head pitches forward → nose moves DOWN in camera).
 *   This gives ~5-10x more vertical variation than raw iris Y.
 *   Normalized by face height (forehead-to-nose distance) for distance invariance.
 */
export function normalizeIrisPosition(data: IrisData): { x: number; y: number } {
  // Horizontal: normalized iris-in-eye position (good signal, head-invariant)
  const lMinX = Math.min(data.leftInnerCorner.x, data.leftOuterCorner.x)
  const lMaxX = Math.max(data.leftInnerCorner.x, data.leftOuterCorner.x)
  const lTx = (data.leftIrisCenter.x - lMinX) / (lMaxX - lMinX)

  const rMinX = Math.min(data.rightInnerCorner.x, data.rightOuterCorner.x)
  const rMaxX = Math.max(data.rightInnerCorner.x, data.rightOuterCorner.x)
  const rTx = (data.rightIrisCenter.x - rMinX) / (rMaxX - rMinX)

  // Vertical: nose tip position relative to forehead, normalized by face height
  // When looking down: head pitches → nose tip drops → noseTipY increases
  // Face height (forehead to nose) provides scale invariance
  const faceHeight = Math.abs(data.noseTip.y - data.forehead.y)
  const avgEyeY = (data.leftIrisCenter.y + data.rightIrisCenter.y) / 2
  // How far down the nose is relative to the eyes, scaled by face size
  const verticalFeature = faceHeight > 0.001
    ? (data.noseTip.y - avgEyeY) / faceHeight
    : data.noseTip.y

  return {
    x: (lTx + rTx) / 2,
    y: verticalFeature,
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
  noseTip: 1,
  forehead: 10,
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
    noseTip: landmarks[L.noseTip],
    forehead: landmarks[L.forehead],
  }
}
