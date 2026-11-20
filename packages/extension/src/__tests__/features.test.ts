import { describe, it, expect } from 'vitest'
import {
  extractFrameFeatures,
  decomposeHeadTransform,
  BlinkDetector,
  FEATURE_INDEX,
  LANDMARK_COUNT_REQUIRED,
  type Vec3,
} from '../offscreen/features'

// ---------------------------------------------------------------------------
// Synthetic face + transform builders
// ---------------------------------------------------------------------------

function baseLandmarks(): Vec3[] {
  const lm: Vec3[] = Array.from({ length: LANDMARK_COUNT_REQUIRED }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
  }))

  // Eye corners (subject-left eye at image left)
  lm[33] = { x: 0.38, y: 0.45, z: 0 }   // left outer
  lm[133] = { x: 0.46, y: 0.45, z: 0 }  // left inner
  lm[362] = { x: 0.54, y: 0.45, z: 0 }  // right inner
  lm[263] = { x: 0.62, y: 0.45, z: 0 }  // right outer
  lm[10] = { x: 0.5, y: 0.3, z: 0 }     // top of head

  // Eyelids
  lm[159] = { x: 0.42, y: 0.435, z: 0 } // left upper
  lm[145] = { x: 0.42, y: 0.465, z: 0 } // left lower
  lm[386] = { x: 0.58, y: 0.435, z: 0 } // right upper
  lm[374] = { x: 0.58, y: 0.465, z: 0 } // right lower

  // Iris boundary points centered in each eye
  const setIris = (indices: [number, number, number, number], cx: number, cy: number): void => {
    const r = 0.008
    lm[indices[0]] = { x: cx + r, y: cy, z: 0 }
    lm[indices[1]] = { x: cx, y: cy - r, z: 0 }
    lm[indices[2]] = { x: cx - r, y: cy, z: 0 }
    lm[indices[3]] = { x: cx, y: cy + r, z: 0 }
  }
  setIris([469, 470, 471, 472], 0.42, 0.45)
  setIris([474, 475, 476, 477], 0.58, 0.45)

  return lm
}

function transformAll(lm: Vec3[], fn: (p: Vec3) => Vec3): Vec3[] {
  return lm.map(fn)
}

type Mat3 = number[][]

function matMul(a: Mat3, b: Mat3): Mat3 {
  return Array.from({ length: 3 }, (_, r) =>
    Array.from({ length: 3 }, (_, c) =>
      (a[r]![0]! * b[0]![c]!) + (a[r]![1]! * b[1]![c]!) + (a[r]![2]! * b[2]![c]!),
    ),
  )
}

/** 4x4 rigid transform data with R = Rz(roll)·Ry(yaw)·Rx(pitch). */
function makeMatrix(
  opts: {
    yaw?: number
    pitch?: number
    roll?: number
    tx?: number
    ty?: number
    tz?: number
    layout?: 'col' | 'row'
  } = {},
): number[] {
  const { yaw = 0, pitch = 0, roll = 0, tx = 0, ty = 0, tz = -45, layout = 'col' } = opts
  const cx = Math.cos(pitch)
  const sx = Math.sin(pitch)
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cz = Math.cos(roll)
  const sz = Math.sin(roll)
  const Rx: Mat3 = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]
  const Ry: Mat3 = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]
  const Rz: Mat3 = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]
  const R = matMul(Rz, matMul(Ry, Rx))
  const t = [tx, ty, tz]

  const data = new Array<number>(16).fill(0)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const v = R[r]![c]!
      if (layout === 'col') data[c * 4 + r] = v
      else data[r * 4 + c] = v
    }
    if (layout === 'col') data[12 + r] = t[r]!
    else data[r * 4 + 3] = t[r]!
  }
  data[15] = 1
  return data
}

const IDENTITY = makeMatrix()
const NO_BLENDSHAPES = new Map<string, number>()

describe('decomposeHeadTransform', () => {
  it('recovers rotation and translation from a column-major matrix', () => {
    const data = makeMatrix({ yaw: 0.3, pitch: -0.15, roll: 0.1, tx: 2, ty: -4, tz: -50 })
    const head = decomposeHeadTransform(data)!
    expect(head.yaw).toBeCloseTo(0.3, 6)
    expect(head.pitch).toBeCloseTo(-0.15, 6)
    expect(head.roll).toBeCloseTo(0.1, 6)
    expect(head.tx).toBeCloseTo(2, 6)
    expect(head.ty).toBeCloseTo(-4, 6)
    expect(head.tz).toBeCloseTo(-50, 6)
  })

  it('detects a row-major layout and decodes it identically', () => {
    const opts = { yaw: 0.25, pitch: 0.1, roll: -0.2, tx: -3, ty: 1, tz: -40 }
    const col = decomposeHeadTransform(makeMatrix({ ...opts, layout: 'col' }))!
    const row = decomposeHeadTransform(makeMatrix({ ...opts, layout: 'row' }))!
    expect(row.yaw).toBeCloseTo(col.yaw, 6)
    expect(row.pitch).toBeCloseTo(col.pitch, 6)
    expect(row.roll).toBeCloseTo(col.roll, 6)
    expect(row.tx).toBeCloseTo(col.tx, 6)
    expect(row.tz).toBeCloseTo(col.tz, 6)
  })

  it('rejects malformed input', () => {
    expect(decomposeHeadTransform([1, 2, 3])).toBeNull()
    const bad = makeMatrix()
    bad[5] = NaN
    expect(decomposeHeadTransform(bad)).toBeNull()
  })
})

describe('extractFrameFeatures', () => {
  it('extracts finite features from a synthetic face', () => {
    const frame = extractFrameFeatures(baseLandmarks(), NO_BLENDSHAPES, IDENTITY)
    expect(frame).not.toBeNull()
    expect(frame!.features.every(Number.isFinite)).toBe(true)
    expect(frame!.ear).toBeGreaterThan(0.1)
  })

  it('returns null without a transformation matrix', () => {
    expect(extractFrameFeatures(baseLandmarks(), NO_BLENDSHAPES, null)).toBeNull()
    expect(extractFrameFeatures(baseLandmarks(), NO_BLENDSHAPES, [1, 2, 3])).toBeNull()
  })

  it('exposes matrix head pose and translation as features', () => {
    const data = makeMatrix({ yaw: 0.2, pitch: -0.1, roll: 0.05, tx: 3, ty: -2, tz: -55 })
    const frame = extractFrameFeatures(baseLandmarks(), NO_BLENDSHAPES, data)!
    expect(frame.features[FEATURE_INDEX.yaw]!).toBeCloseTo(0.2, 6)
    expect(frame.features[FEATURE_INDEX.pitch]!).toBeCloseTo(-0.1, 6)
    expect(frame.features[FEATURE_INDEX.roll]!).toBeCloseTo(0.05, 6)
    expect(frame.features[FEATURE_INDEX.headTx]!).toBeCloseTo(3, 6)
    expect(frame.features[FEATURE_INDEX.headTy]!).toBeCloseTo(-2, 6)
    expect(frame.features[FEATURE_INDEX.headTz]!).toBeCloseTo(-55, 6)
    expect(frame.headPose.yaw).toBeCloseTo(0.2, 6)
  })

  it('iris features are invariant to face translation', () => {
    const lm = baseLandmarks()
    const moved = transformAll(lm, (p) => ({ x: p.x + 0.1, y: p.y - 0.07, z: p.z }))

    const f1 = extractFrameFeatures(lm, NO_BLENDSHAPES, IDENTITY)!
    const f2 = extractFrameFeatures(moved, NO_BLENDSHAPES, IDENTITY)!

    for (const key of ['irisLx', 'irisLy', 'irisRx', 'irisRy'] as const) {
      expect(f2.features[FEATURE_INDEX[key]]!).toBeCloseTo(f1.features[FEATURE_INDEX[key]]!, 8)
    }
    // But the translation IS visible in the raw eye-center position
    expect(f2.eyeCenter.x).not.toBeCloseTo(f1.eyeCenter.x, 3)
  })

  it('iris features are invariant to face scale (distance to camera)', () => {
    const lm = baseLandmarks()
    const center = { x: 0.5, y: 0.45 }
    const scaled = transformAll(lm, (p) => ({
      x: center.x + (p.x - center.x) * 0.7,
      y: center.y + (p.y - center.y) * 0.7,
      z: p.z * 0.7,
    }))

    const f1 = extractFrameFeatures(lm, NO_BLENDSHAPES, IDENTITY)!
    const f2 = extractFrameFeatures(scaled, NO_BLENDSHAPES, IDENTITY)!

    for (const key of ['irisLx', 'irisLy', 'irisRx', 'irisRy', 'lidGapL', 'lidGapR'] as const) {
      expect(f2.features[FEATURE_INDEX[key]]!).toBeCloseTo(f1.features[FEATURE_INDEX[key]]!, 6)
    }
    // Distance change IS visible in interocular
    expect(f2.interocular).toBeCloseTo(f1.interocular * 0.7, 6)
  })

  it('iris features are invariant to in-plane head roll of the landmarks', () => {
    const lm = baseLandmarks()
    const angle = 0.3 // ~17 degrees
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const center = { x: 0.5, y: 0.45 }
    const rolled = transformAll(lm, (p) => ({
      x: center.x + (p.x - center.x) * cos - (p.y - center.y) * sin,
      y: center.y + (p.x - center.x) * sin + (p.y - center.y) * cos,
      z: p.z,
    }))

    const f1 = extractFrameFeatures(lm, NO_BLENDSHAPES, IDENTITY)!
    const f2 = extractFrameFeatures(rolled, NO_BLENDSHAPES, makeMatrix({ roll: angle }))!

    for (const key of ['irisLx', 'irisLy', 'irisRx', 'irisRy'] as const) {
      expect(f2.features[FEATURE_INDEX[key]]!).toBeCloseTo(f1.features[FEATURE_INDEX[key]]!, 6)
    }
    // Roll IS visible in the (matrix-derived) head-pose feature
    expect(Math.abs(f2.headPose.roll - f1.headPose.roll)).toBeCloseTo(angle, 6)
  })

  it('responds to horizontal iris movement with consistent sign in both eyes', () => {
    const lm = baseLandmarks()
    const shifted = [...lm]
    const shiftIris = (indices: number[], dx: number): void => {
      for (const i of indices) {
        shifted[i] = { ...lm[i]!, x: lm[i]!.x + dx }
      }
    }
    shiftIris([469, 470, 471, 472], 0.01)
    shiftIris([474, 475, 476, 477], 0.01)

    const f1 = extractFrameFeatures(lm, NO_BLENDSHAPES, IDENTITY)!
    const f2 = extractFrameFeatures(shifted, NO_BLENDSHAPES, IDENTITY)!

    const dL = f2.features[FEATURE_INDEX.irisLx]! - f1.features[FEATURE_INDEX.irisLx]!
    const dR = f2.features[FEATURE_INDEX.irisRx]! - f1.features[FEATURE_INDEX.irisRx]!
    expect(dL).toBeGreaterThan(0)
    expect(dR).toBeGreaterThan(0)
  })

  it('responds to vertical iris movement (the axis the old pipeline missed)', () => {
    const lm = baseLandmarks()
    const shifted = [...lm]
    const shiftIris = (indices: number[], dy: number): void => {
      for (const i of indices) {
        shifted[i] = { ...lm[i]!, y: lm[i]!.y + dy }
      }
    }
    shiftIris([469, 470, 471, 472], 0.008)
    shiftIris([474, 475, 476, 477], 0.008)

    const f1 = extractFrameFeatures(lm, NO_BLENDSHAPES, IDENTITY)!
    const f2 = extractFrameFeatures(shifted, NO_BLENDSHAPES, IDENTITY)!

    expect(
      Math.abs(f2.features[FEATURE_INDEX.irisLy]! - f1.features[FEATURE_INDEX.irisLy]!),
    ).toBeGreaterThan(0.01)
    expect(
      Math.abs(f2.features[FEATURE_INDEX.irisRy]! - f1.features[FEATURE_INDEX.irisRy]!),
    ).toBeGreaterThan(0.01)
  })

  it('vergence reflects a left/right iris disparity', () => {
    const lm = baseLandmarks()
    const shifted = [...lm]
    // Move ONLY the left iris outward
    for (const i of [469, 470, 471, 472]) {
      shifted[i] = { ...lm[i]!, x: lm[i]!.x + 0.006 }
    }
    const f1 = extractFrameFeatures(lm, NO_BLENDSHAPES, IDENTITY)!
    const f2 = extractFrameFeatures(shifted, NO_BLENDSHAPES, IDENTITY)!
    expect(
      f2.features[FEATURE_INDEX.vergence]! - f1.features[FEATURE_INDEX.vergence]!,
    ).toBeGreaterThan(0.01)
  })

  it('EAR drops when the eyelids close', () => {
    const lm = baseLandmarks()
    const closed = [...lm]
    closed[159] = { ...lm[159]!, y: 0.449 }
    closed[145] = { ...lm[145]!, y: 0.451 }
    closed[386] = { ...lm[386]!, y: 0.449 }
    closed[374] = { ...lm[374]!, y: 0.451 }

    const open = extractFrameFeatures(lm, NO_BLENDSHAPES, IDENTITY)!
    const blink = extractFrameFeatures(closed, NO_BLENDSHAPES, IDENTITY)!
    expect(blink.ear).toBeLessThan(open.ear * 0.2)
  })

  it('uses blendshape gaze scores when available', () => {
    const lm = baseLandmarks()
    const withBs = extractFrameFeatures(
      lm,
      new Map([
        ['eyeLookDownLeft', 0.8],
        ['eyeLookDownRight', 0.8],
        ['eyeLookUpLeft', 0.0],
        ['eyeLookUpRight', 0.0],
      ]),
      IDENTITY,
    )!
    const withoutBs = extractFrameFeatures(lm, NO_BLENDSHAPES, IDENTITY)!
    expect(withBs.features[FEATURE_INDEX.bsY]!).toBeCloseTo(0.8, 6)
    expect(withoutBs.features[FEATURE_INDEX.bsY]!).toBe(0)
  })

  it('returns null for degenerate landmark arrays', () => {
    expect(extractFrameFeatures([], NO_BLENDSHAPES, IDENTITY)).toBeNull()
    const collapsed = Array.from({ length: LANDMARK_COUNT_REQUIRED }, () => ({
      x: 0.5,
      y: 0.5,
      z: 0,
    }))
    expect(extractFrameFeatures(collapsed, NO_BLENDSHAPES, IDENTITY)).toBeNull()
  })
})

describe('BlinkDetector', () => {
  it('flags frames below the adaptive threshold and pads after recovery', () => {
    const detector = new BlinkDetector()
    let ts = 0

    // Build a baseline of open-eye EAR ~0.3
    for (let i = 0; i < 30; i++) {
      expect(detector.update(0.3, ts)).toBe(false)
      ts += 33
    }

    // Sudden closure
    expect(detector.update(0.05, ts)).toBe(true)
    ts += 33
    // Recovered EAR but still inside the pad window
    expect(detector.update(0.3, ts)).toBe(true)
    // Well past the pad
    ts += 200
    expect(detector.update(0.3, ts)).toBe(false)
  })

  it('adapts the threshold downward when the user looks down', () => {
    const detector = new BlinkDetector()
    let ts = 0
    for (let i = 0; i < 50; i++) {
      detector.update(0.3, ts)
      ts += 33
    }
    // Looking down lowers EAR gradually; a fixed 0.2-of-0.3 threshold would
    // fire, but the rolling baseline adapts
    for (let i = 0; i < 50; i++) {
      detector.update(0.22, ts)
      ts += 33
    }
    ts += 200 // clear any pad from the transition
    expect(detector.update(0.21, ts)).toBe(false)
  })
})
