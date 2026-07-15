// ---------------------------------------------------------------------------
// Ridge regression mapping gaze features -> screen coordinates.
//
// Replaces the previous unregularized 6-term quadratic. Design choices, all
// evidence-backed (EyeTrax / EMC-Gaze / calibration-methods literature):
//  - z-scored features, closed-form ridge (bias unregularized)
//  - lambda chosen by leave-one-calibration-point-out cross-validation
//  - per-point MAD trimming of samples before fitting
//  - rows weighted so every calibration point contributes equally
//  - features that were constant during calibration are excluded outright
//    (their coefficients would be unidentifiable, and a tiny stored std
//    would amplify runtime variation into wild predictions)
// ---------------------------------------------------------------------------

import { FEATURE_COUNT, type HeadPose } from './features'
import type { WindowGeometry, PhysicalScreenInfo } from '@gazekit/shared'

export interface CalibrationPointData {
  /** Target position in global screen px */
  screenX: number
  screenY: number
  /** Accepted feature vectors recorded while the user fixated this target */
  samples: number[][]
}

export interface GazeModel {
  version: 2
  /** length FEATURE_COUNT + 1, bias last */
  weightsX: number[]
  weightsY: number[]
  featMean: number[]
  /** 0 marks an excluded (constant-at-calibration) feature */
  featStd: number[]
  lambda: number
  trainRmsePx: number
  calibScreen: { width: number; height: number }
  /**
   * Bounding box of the calibration targets in GLOBAL screen px. Predictions
   * are clamped relative to this box — the calibrated monitor's origin is NOT
   * necessarily (0,0) on multi-monitor desktops.
   */
  calibBounds: { left: number; top: number; right: number; bottom: number }
  calibWindow: WindowGeometry
  refHeadPose: HeadPose
  refInterocular: number
  cameraDeviceId: string | null
  /** Actual capture resolution at calibration — sessions must match its aspect */
  cameraSize: { width: number; height: number } | null
  /**
   * Physical screen geometry (null when the user skipped the screen-size
   * input; absent on models saved before it existed). Enables visual-degree
   * thresholds and metrics. Optional so older stored models stay valid.
   */
  physical?: PhysicalScreenInfo | null
  calibratedAt: string
  validation: {
    medianErrorPx: number
    p95ErrorPx: number
    precisionPx: number
  } | null
}

const LAMBDA_GRID = [1e-3, 1e-2, 1e-1, 1, 10]
const MAD_TRIM_THRESHOLD = 3.5
const MIN_SAMPLES_PER_POINT = 6
const MIN_POINTS = 8
const STD_EXCLUSION_THRESHOLD = 1e-4

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number)
}

/**
 * Drop samples whose primary iris features (indices 0-3) deviate more than
 * MAD_TRIM_THRESHOLD robust standard deviations from the point's median —
 * residual blinks, glances away, landmark glitches.
 */
export function trimPointSamples(samples: number[][]): number[][] {
  if (samples.length < 4) return samples
  const CORE_FEATURES = [0, 1, 2, 3]
  const medians = CORE_FEATURES.map((f) => median(samples.map((s) => s[f] as number)))
  const mads = CORE_FEATURES.map((f, i) =>
    median(samples.map((s) => Math.abs((s[f] as number) - (medians[i] as number)))),
  )
  return samples.filter((s) =>
    CORE_FEATURES.every((f, i) => {
      // 1.4826 converts MAD to a robust sigma estimate
      const sigma = (mads[i] as number) * 1.4826
      if (sigma < 1e-9) return true
      return Math.abs((s[f] as number) - (medians[i] as number)) <= MAD_TRIM_THRESHOLD * sigma
    }),
  )
}

/** Solve Ax = b via Gaussian elimination with partial pivoting. */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length
  const aug = A.map((row, i) => [...row, b[i] as number])
  const rowAt = (i: number): number[] => aug[i] as number[]

  for (let col = 0; col < n; col++) {
    let maxRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(rowAt(row)[col] as number) > Math.abs(rowAt(maxRow)[col] as number)) {
        maxRow = row
      }
    }
    ;[aug[col], aug[maxRow]] = [rowAt(maxRow), rowAt(col)]

    const pivotRow = rowAt(col)
    const pivot = pivotRow[col] as number
    if (Math.abs(pivot) < 1e-12) {
      throw new Error('Singular system in ridge solve')
    }

    for (let row = col + 1; row < n; row++) {
      const target = rowAt(row)
      const factor = (target[col] as number) / pivot
      for (let j = col; j <= n; j++) {
        target[j] = (target[j] as number) - factor * (pivotRow[j] as number)
      }
    }
  }

  const x = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    const row = rowAt(i)
    let v = row[n] as number
    for (let j = i + 1; j < n; j++) {
      v -= (row[j] as number) * (x[j] as number)
    }
    x[i] = v / (row[i] as number)
  }
  return x
}

interface Standardization {
  mean: number[]
  std: number[]
}

/** Weighted mean/std per feature; std=0 marks an excluded feature. */
function computeStandardization(rows: number[][], weights: number[]): Standardization {
  const n = FEATURE_COUNT
  const wSum = weights.reduce((a, b) => a + b, 0)
  const mean = new Array<number>(n).fill(0)
  for (let k = 0; k < rows.length; k++) {
    const row = rows[k] as number[]
    const w = weights[k] as number
    for (let j = 0; j < n; j++) mean[j] = (mean[j] as number) + w * (row[j] as number)
  }
  for (let j = 0; j < n; j++) mean[j] = (mean[j] as number) / wSum

  const variance = new Array<number>(n).fill(0)
  for (let k = 0; k < rows.length; k++) {
    const row = rows[k] as number[]
    const w = weights[k] as number
    for (let j = 0; j < n; j++) {
      const d = (row[j] as number) - (mean[j] as number)
      variance[j] = (variance[j] as number) + w * d * d
    }
  }
  const std = variance.map((v) => {
    const s = Math.sqrt(v / wSum)
    return s < STD_EXCLUSION_THRESHOLD ? 0 : s
  })
  return { mean, std }
}

function standardizeRow(row: number[], st: Standardization): number[] {
  const out = new Array<number>(FEATURE_COUNT + 1)
  for (let j = 0; j < FEATURE_COUNT; j++) {
    const std = st.std[j] as number
    out[j] = std === 0 ? 0 : ((row[j] as number) - (st.mean[j] as number)) / std
  }
  out[FEATURE_COUNT] = 1 // bias
  return out
}

/** Weighted ridge: (X'WX + lambda*D) w = X'Wy, D = I except 0 for bias. */
function ridgeSolve(
  X: number[][],
  yx: number[],
  yy: number[],
  weights: number[],
  lambda: number,
): { wx: number[]; wy: number[] } {
  const d = FEATURE_COUNT + 1
  const XtWX: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0))
  const XtWyx = new Array<number>(d).fill(0)
  const XtWyy = new Array<number>(d).fill(0)

  for (let k = 0; k < X.length; k++) {
    const w = weights[k] as number
    const row = X[k] as number[]
    const tx = yx[k] as number
    const ty = yy[k] as number
    for (let i = 0; i < d; i++) {
      const wi = w * (row[i] as number)
      const outRow = XtWX[i] as number[]
      for (let j = i; j < d; j++) {
        outRow[j] = (outRow[j] as number) + wi * (row[j] as number)
      }
      XtWyx[i] = (XtWyx[i] as number) + wi * tx
      XtWyy[i] = (XtWyy[i] as number) + wi * ty
    }
  }
  for (let i = 0; i < d; i++) {
    const rowI = XtWX[i] as number[]
    for (let j = 0; j < i; j++) {
      rowI[j] = (XtWX[j] as number[])[i] as number
    }
  }
  for (let i = 0; i < d - 1; i++) {
    const rowI = XtWX[i] as number[]
    rowI[i] = (rowI[i] as number) + lambda // bias unregularized
  }

  return {
    wx: solveLinearSystem(XtWX, XtWyx),
    wy: solveLinearSystem(XtWX.map((r) => [...r]), XtWyy),
  }
}

function predictRow(stdRow: number[], wx: number[], wy: number[]): { x: number; y: number } {
  let x = 0
  let y = 0
  for (let i = 0; i < stdRow.length; i++) {
    const v = stdRow[i] as number
    x += (wx[i] as number) * v
    y += (wy[i] as number) * v
  }
  return { x, y }
}

export interface FitResult {
  weightsX: number[]
  weightsY: number[]
  featMean: number[]
  featStd: number[]
  lambda: number
  trainRmsePx: number
  usedPoints: number
}

/**
 * Fit the gaze model on calibration points. Throws when the data cannot
 * support a trustworthy fit (too few valid points, singular system,
 * non-finite result) — callers must route the user back to calibration.
 */
export function fitGazeModel(points: CalibrationPointData[]): FitResult {
  const cleaned = points
    .map((p) => ({ ...p, samples: trimPointSamples(p.samples) }))
    .filter((p) => p.samples.length >= MIN_SAMPLES_PER_POINT)

  if (cleaned.length < MIN_POINTS) {
    throw new Error(
      `Calibration produced only ${cleaned.length} usable points (need >= ${MIN_POINTS})`,
    )
  }

  // Flatten with per-point equal weighting
  const rows: number[][] = []
  const yx: number[] = []
  const yy: number[] = []
  const weights: number[] = []
  const pointIndex: number[] = []
  cleaned.forEach((p, pi) => {
    const w = 1 / p.samples.length
    for (const s of p.samples) {
      rows.push(s)
      yx.push(p.screenX)
      yy.push(p.screenY)
      weights.push(w)
      pointIndex.push(pi)
    }
  })

  const st = computeStandardization(rows, weights)
  const X = rows.map((r) => standardizeRow(r, st))

  // Leave-one-point-out CV over the lambda grid
  let bestLambda: number | null = null
  let bestScore = Infinity
  for (const lambda of LAMBDA_GRID) {
    let total = 0
    let ok = true
    for (let held = 0; held < cleaned.length; held++) {
      const trainIdx: number[] = []
      const testIdx: number[] = []
      for (let k = 0; k < X.length; k++) {
        ;(pointIndex[k] === held ? testIdx : trainIdx).push(k)
      }
      try {
        const { wx, wy } = ridgeSolve(
          trainIdx.map((k) => X[k] as number[]),
          trainIdx.map((k) => yx[k] as number),
          trainIdx.map((k) => yy[k] as number),
          trainIdx.map((k) => weights[k] as number),
          lambda,
        )
        let errSum = 0
        for (const k of testIdx) {
          const p = predictRow(X[k] as number[], wx, wy)
          errSum += Math.hypot(p.x - (yx[k] as number), p.y - (yy[k] as number))
        }
        total += errSum / testIdx.length
      } catch {
        ok = false
        break
      }
    }
    if (ok) {
      const score = total / cleaned.length
      if (score < bestScore) {
        bestScore = score
        bestLambda = lambda
      }
    }
  }
  if (bestLambda === null) {
    throw new Error('Cross-validation failed for every lambda — degenerate calibration data')
  }

  const { wx, wy } = ridgeSolve(X, yx, yy, weights, bestLambda)

  for (const v of [...wx, ...wy]) {
    if (!Number.isFinite(v)) throw new Error('Non-finite coefficients in gaze model fit')
  }

  let sq = 0
  for (let k = 0; k < X.length; k++) {
    const p = predictRow(X[k] as number[], wx, wy)
    const w = weights[k] as number
    sq += w * (Math.pow(p.x - (yx[k] as number), 2) + Math.pow(p.y - (yy[k] as number), 2))
  }
  const wSum = weights.reduce((a, b) => a + b, 0)
  const trainRmsePx = Math.sqrt(sq / wSum)

  return {
    weightsX: wx,
    weightsY: wy,
    featMean: st.mean,
    featStd: st.std,
    lambda: bestLambda,
    trainRmsePx,
    usedPoints: cleaned.length,
  }
}

/** Predict gaze in global screen px from a raw feature vector. */
export function predictScreenPx(
  model: Pick<GazeModel, 'weightsX' | 'weightsY' | 'featMean' | 'featStd'>,
  features: number[],
): { x: number; y: number } {
  const row = standardizeRow(features, { mean: model.featMean, std: model.featStd })
  return predictRow(row, model.weightsX, model.weightsY)
}

/**
 * Structural + numeric validation for a model loaded from storage. Covers
 * every field the offscreen runtime dereferences — a partially-written or
 * hand-edited model must be rejected, not crash the gaze loop.
 */
export function isValidGazeModel(data: unknown): data is GazeModel {
  const m = data as Partial<GazeModel> | null | undefined
  if (!m || m.version !== 2) return false
  const weightsX = m.weightsX
  const weightsY = m.weightsY
  const featMean = m.featMean
  const featStd = m.featStd
  for (const arr of [weightsX, weightsY, featMean, featStd]) {
    if (!Array.isArray(arr)) return false
    if (!arr.every((v) => typeof v === 'number' && Number.isFinite(v))) return false
  }
  if (weightsX!.length !== FEATURE_COUNT + 1 || weightsY!.length !== FEATURE_COUNT + 1) {
    return false
  }
  if (featMean!.length !== FEATURE_COUNT || featStd!.length !== FEATURE_COUNT) return false
  if (
    !m.calibScreen ||
    !Number.isFinite(m.calibScreen.width) ||
    !Number.isFinite(m.calibScreen.height)
  ) {
    return false
  }
  if (
    !m.calibBounds ||
    !Number.isFinite(m.calibBounds.left) ||
    !Number.isFinite(m.calibBounds.top) ||
    !Number.isFinite(m.calibBounds.right) ||
    !Number.isFinite(m.calibBounds.bottom)
  ) {
    return false
  }
  if (
    !m.refHeadPose ||
    !Number.isFinite(m.refHeadPose.yaw) ||
    !Number.isFinite(m.refHeadPose.pitch) ||
    !Number.isFinite(m.refHeadPose.roll)
  ) {
    return false
  }
  if (!Number.isFinite(m.refInterocular)) return false
  return true
}

/** pxPerDeg from a model's physical block, or null when absent/malformed. */
export function modelPxPerDeg(model: Pick<GazeModel, 'physical'> | null): number | null {
  const v = model?.physical?.pxPerDeg
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}
