// ---------------------------------------------------------------------------
// Gaze feature extraction from MediaPipe FaceLandmarker output.
//
// All eye landmarks are first canonicalized into a face-attached coordinate
// frame (origin = midpoint of the outer eye corners, X = corner-to-corner
// axis, Y from the top-of-head landmark, unit = inter-ocular distance). This
// removes head translation, scale, and rotation from the iris features, so
// the calibration mapping does not silently break when the head moves.
// Head pose (yaw/pitch/roll of that frame) is fed to the regression as
// separate explicit features.
//
// Vertical gaze is the hard axis (eyelids occlude the limbus): it is covered
// by three complementary cues — canonical iris-Y, eyelid apertures (the lids
// track vertical gaze), and the eyeLookUp/Down blendshapes.
// ---------------------------------------------------------------------------

export interface Vec3 {
  x: number
  y: number
  z: number
}

// MediaPipe FaceLandmarker landmark indices (478-point mesh with iris)
const LM = {
  leftOuterCorner: 33,
  leftInnerCorner: 133,
  rightInnerCorner: 362,
  rightOuterCorner: 263,
  leftUpperLid: 159,
  leftLowerLid: 145,
  rightUpperLid: 386,
  rightLowerLid: 374,
  topOfHead: 10,
  // Iris boundary points (the boundary mean is more stable than the center
  // point 468/473 in the FaceLandmarker task model)
  leftIrisBoundary: [469, 470, 471, 472],
  rightIrisBoundary: [474, 475, 476, 477],
} as const

export const LANDMARK_COUNT_REQUIRED = 478

export const FEATURE_NAMES = [
  'irisLx', 'irisLy', 'irisRx', 'irisRy',
  'lidGapL', 'lidGapR',
  'yaw', 'pitch', 'roll',
  'bsX', 'bsY',
  'faceX', 'faceY', 'interocular',
  'irisXSq', 'irisYSq', 'irisXY',
] as const

export const FEATURE_COUNT = FEATURE_NAMES.length

/** Index of each named feature in the feature vector. */
export const FEATURE_INDEX = Object.fromEntries(
  FEATURE_NAMES.map((name, i) => [name, i]),
) as Record<(typeof FEATURE_NAMES)[number], number>

export interface HeadPose {
  yaw: number
  pitch: number
  roll: number
}

export interface FrameFeatures {
  /** Regression input vector, length FEATURE_COUNT */
  features: number[]
  /** Raw eye aspect ratio (avg both eyes) — blink signal */
  ear: number
  headPose: HeadPose
  /** Eye-corner midpoint in raw normalized frame coords */
  eyeCenter: { x: number; y: number }
  /** Raw inter-ocular distance (normalized frame units) — depth proxy */
  interocular: number
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function norm(a: Vec3): number {
  return Math.sqrt(dot(a, a))
}

function normalize(a: Vec3): Vec3 {
  const n = norm(a)
  if (n < 1e-9) return { x: 0, y: 0, z: 0 }
  return { x: a.x / n, y: a.y / n, z: a.z / n }
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
}

function meanOf(points: Vec3[]): Vec3 {
  let x = 0
  let y = 0
  let z = 0
  for (const p of points) {
    x += p.x
    y += p.y
    z += p.z
  }
  const n = points.length
  return { x: x / n, y: y / n, z: z / n }
}

/** Blendshape scores by category name (empty map if blendshapes disabled). */
export type BlendshapeMap = ReadonlyMap<string, number>

function bs(map: BlendshapeMap, name: string): number {
  return map.get(name) ?? 0
}

/**
 * Extract the gaze feature vector from one frame of landmarks.
 * Returns null when the face geometry is degenerate (e.g. landmarks collapsed).
 */
export function extractFrameFeatures(
  landmarks: Vec3[],
  blendshapes: BlendshapeMap,
): FrameFeatures | null {
  if (landmarks.length < LANDMARK_COUNT_REQUIRED) return null

  // Length is guarded above; every LM index is within [0, 478)
  const at = (i: number): Vec3 => landmarks[i] as Vec3

  const L = at(LM.leftOuterCorner)
  const R = at(LM.rightOuterCorner)
  const T = at(LM.topOfHead)

  const eyeCenter = midpoint(L, R)

  const interocular = norm(sub(R, L))
  if (interocular < 1e-6) return null

  // Face-attached orthonormal basis
  const xAxis = normalize(sub(R, L))
  const yApprox = normalize(sub(T, eyeCenter))
  const yProj = dot(yApprox, xAxis)
  const yAxis = normalize({
    x: yApprox.x - yProj * xAxis.x,
    y: yApprox.y - yProj * xAxis.y,
    z: yApprox.z - yProj * xAxis.z,
  })
  const zAxis = cross(xAxis, yAxis)
  if (norm(yAxis) < 1e-6 || norm(zAxis) < 1e-6) return null

  // p in canonical face frame, unit = inter-ocular distance
  const canon = (p: Vec3): Vec3 => {
    const d = sub(p, eyeCenter)
    return {
      x: dot(d, xAxis) / interocular,
      y: dot(d, yAxis) / interocular,
      z: dot(d, zAxis) / interocular,
    }
  }

  // Head pose: R = [xAxis | yAxis | zAxis] maps face frame -> camera frame.
  // Standard ZYX Euler decomposition; exact convention doesn't matter, only
  // that these are smooth, consistent functions of head orientation.
  const yaw = Math.atan2(-xAxis.z, Math.sqrt(yAxis.z * yAxis.z + zAxis.z * zAxis.z))
  const pitch = Math.atan2(yAxis.z, zAxis.z)
  const roll = Math.atan2(xAxis.y, xAxis.x)

  // Per-eye iris offsets in the canonical frame, relative to each eye's own
  // corner midpoint
  const irisLRaw = meanOf(LM.leftIrisBoundary.map(at))
  const irisRRaw = meanOf(LM.rightIrisBoundary.map(at))
  const leftMidRaw = midpoint(at(LM.leftOuterCorner), at(LM.leftInnerCorner))
  const rightMidRaw = midpoint(at(LM.rightOuterCorner), at(LM.rightInnerCorner))

  const irisL = canon(irisLRaw)
  const irisR = canon(irisRRaw)
  const leftMid = canon(leftMidRaw)
  const rightMid = canon(rightMidRaw)

  const irisLx = irisL.x - leftMid.x
  const irisLy = irisL.y - leftMid.y
  const irisRx = irisR.x - rightMid.x
  const irisRy = irisR.y - rightMid.y

  // Eyelid apertures in the canonical frame (features, not normalizers —
  // the lids follow the iris vertically, so aperture is a vertical gaze cue)
  const lidGapL = Math.abs(canon(at(LM.leftUpperLid)).y - canon(at(LM.leftLowerLid)).y)
  const lidGapR = Math.abs(canon(at(LM.rightUpperLid)).y - canon(at(LM.rightLowerLid)).y)

  // Blendshape gaze re-encoding (MediaPipe's learned, roughly head-normalized
  // eye-rotation estimate). Zero when blendshapes are unavailable.
  const bsX =
    (bs(blendshapes, 'eyeLookOutRight') + bs(blendshapes, 'eyeLookInLeft')) / 2 -
    (bs(blendshapes, 'eyeLookOutLeft') + bs(blendshapes, 'eyeLookInRight')) / 2
  const bsY =
    (bs(blendshapes, 'eyeLookDownLeft') + bs(blendshapes, 'eyeLookDownRight')) / 2 -
    (bs(blendshapes, 'eyeLookUpLeft') + bs(blendshapes, 'eyeLookUpRight')) / 2

  // Quadratic terms of the averaged iris offset (screen-plane flattening of
  // the tangent nonlinearity); ridge + CV keeps these from overfitting
  const ax = (irisLx + irisRx) / 2
  const ay = (irisLy + irisRy) / 2

  // Raw eye aspect ratio for blink detection (raw 2D distances, per eye:
  // lid gap / eye width)
  const dist2d = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y)
  const earL =
    dist2d(at(LM.leftUpperLid), at(LM.leftLowerLid)) /
    Math.max(1e-9, dist2d(at(LM.leftOuterCorner), at(LM.leftInnerCorner)))
  const earR =
    dist2d(at(LM.rightUpperLid), at(LM.rightLowerLid)) /
    Math.max(1e-9, dist2d(at(LM.rightOuterCorner), at(LM.rightInnerCorner)))
  const ear = (earL + earR) / 2

  const features = [
    irisLx, irisLy, irisRx, irisRy,
    lidGapL, lidGapR,
    yaw, pitch, roll,
    bsX, bsY,
    eyeCenter.x, eyeCenter.y, interocular,
    ax * ax, ay * ay, ax * ay,
  ]

  for (const f of features) {
    if (!Number.isFinite(f)) return null
  }

  return {
    features,
    ear,
    headPose: { yaw, pitch, roll },
    eyeCenter: { x: eyeCenter.x, y: eyeCenter.y },
    interocular,
  }
}

// ---------------------------------------------------------------------------
// Blink detection with an adaptive threshold.
//
// A fixed EAR threshold misfires because looking down also lowers the EAR.
// Following EyeTrax: keep a rolling baseline of recent open-eye EAR values
// and flag a blink when EAR < 80% of that baseline (absolute fallback 0.2
// until the baseline exists). Gaze is unreliable while the lid re-opens, so
// the blink flag is held for a padding window after EAR recovers.
// ---------------------------------------------------------------------------

const EAR_HISTORY_SIZE = 50
const EAR_BASELINE_MIN_SAMPLES = 10
const EAR_ADAPTIVE_RATIO = 0.8
const EAR_FALLBACK_THRESHOLD = 0.2
const BLINK_PAD_MS = 120

export class BlinkDetector {
  private history: number[] = []
  private blinkHoldUntil = -Infinity

  /** Feed one frame; returns true if the frame should be treated as a blink. */
  update(ear: number, tsMs: number): boolean {
    const threshold =
      this.history.length >= EAR_BASELINE_MIN_SAMPLES
        ? EAR_ADAPTIVE_RATIO * (this.history.reduce((a, b) => a + b, 0) / this.history.length)
        : EAR_FALLBACK_THRESHOLD

    const isClosed = ear < threshold
    if (isClosed) {
      this.blinkHoldUntil = tsMs + BLINK_PAD_MS
    }

    // Every frame feeds the baseline: brief blinks barely dent a 50-frame
    // mean, while a sustained look-down (which legitimately lowers EAR) must
    // pull the threshold down with it or every subsequent frame gets flagged
    this.history.push(ear)
    if (this.history.length > EAR_HISTORY_SIZE) this.history.shift()

    return isClosed || tsMs < this.blinkHoldUntil
  }

  reset(): void {
    this.history = []
    this.blinkHoldUntil = -Infinity
  }
}
