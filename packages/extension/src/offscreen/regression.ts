// ---------------------------------------------------------------------------
// Ridge regression mapping gaze features -> screen coordinates (v3).
//
// Trained on smooth-pursuit calibration data: every sample carries its OWN
// screen label (the dot moves during transits), tagged with the path segment
// it came from. Design choices, all evidence-backed (EyeTrax / EMC-Gaze /
// pursuit-calibration literature):
//  - z-scored features, closed-form ridge (bias unregularized)
//  - lambda chosen by leave-one-SEGMENT-out cross-validation (holding out a
//    whole path segment measures spatial generalization; holding out random
//    samples would leak, since neighbors in time are nearly identical)
//  - per-segment MAD trimming for stationary segments, then a two-pass
//    robust fit: fit, drop samples with wild residuals (moments where the
//    eye wasn't actually tracking the dot), refit
//  - rows weighted so every segment contributes equally within its kind;
//    dwell samples (stationary, clean) count double vs moving transits
//  - features that were constant during calibration are excluded outright
//    (their coefficients would be unidentifiable, and a tiny stored std
//    would amplify runtime variation into wild predictions)
// ---------------------------------------------------------------------------

import { FEATURE_COUNT, type HeadPose } from './features'
import type { WindowGeometry, PhysicalScreenInfo } from '@gazekit/shared'

export type CalibrationSampleKind = 'dwell' | 'transit' | 'vor'

export interface CalibrationSample {
  /** Where the user was looking when the frame was captured, global screen px */
  screenX: number
  screenY: number
  features: number[]
  /** Path-segment id — the cross-validation fold and weighting unit */
  group: string
  kind: CalibrationSampleKind
}

export interface GazeModel {
  version: 3
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
  /** Fit diagnostics (not required at runtime) */
  fitStats?: {
    usedGroups: number
    usedSamples: number
    prunedSamples: number
  } | null
  calibratedAt: string
  validation: {
    medianErrorPx: number
    p95ErrorPx: number
    precisionPx: number
  } | null
}

const LAMBDA_GRID = [1e-3, 1e-2, 1e-1, 1, 10]
const MAD_TRIM_THRESHOLD = 3.5
const STD_EXCLUSION_THRESHOLD = 1e-4

// Sample-quality weighting per segment kind: stationary dwells are the
// cleanest labels; vor labels are constant but rely on the user actually
// holding fixation through the head turn.
const KIND_WEIGHT: Record<CalibrationSampleKind, number> = {
  dwell: 2.0,
  transit: 1.0,
  vor: 1.5,
}

const MIN_SAMPLES_PER_GROUP: Record<CalibrationSampleKind, number> = {
  dwell: 6,
  transit: 10,
  vor: 10,
}

const MIN_GROUPS = 8
const MIN_DISTINCT_DWELL_POSITIONS = 4
const MIN_TOTAL_SAMPLES = 120
const MIN_LABEL_SPAN_X_PX = 400
const MIN_LABEL_SPAN_Y_PX = 250

// Residual prune: drop samples the pass-1 model misses catastrophically
// (the eye wasn't on the dot), but never more than a quarter of the data —
// beyond that the calibration is untrustworthy, not merely noisy.
const PRUNE_MIN_PX = 120
const PRUNE_MEDIAN_MULTIPLE = 3
const PRUNE_MAX_FRACTION = 0.25
const MIN_SAMPLES_AFTER_PRUNE = 80

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number)
}

/**
 * Drop samples whose primary iris features (indices 0-3) deviate more than
 * MAD_TRIM_THRESHOLD robust standard deviations from the group's median —
 * residual blinks, glances away, landmark glitches. Only meaningful for
 * stationary segments (dwell/vor), where the features should be constant.
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
  usedGroups: number
  usedSamples: number
  prunedSamples: number
}

interface FlatData {
  rows: number[][]
  yx: number[]
  yy: number[]
  weights: number[]
  groupIndex: number[]
  groupIds: string[]
}

/** Flatten samples with per-group equal weighting (scaled by segment kind). */
function flatten(samples: CalibrationSample[]): FlatData {
  const groupIds = [...new Set(samples.map((s) => s.group))]
  const idToIndex = new Map(groupIds.map((id, i) => [id, i]))
  const counts = new Map<string, number>()
  for (const s of samples) counts.set(s.group, (counts.get(s.group) ?? 0) + 1)

  const rows: number[][] = []
  const yx: number[] = []
  const yy: number[] = []
  const weights: number[] = []
  const groupIndex: number[] = []
  for (const s of samples) {
    rows.push(s.features)
    yx.push(s.screenX)
    yy.push(s.screenY)
    weights.push(KIND_WEIGHT[s.kind] / (counts.get(s.group) as number))
    groupIndex.push(idToIndex.get(s.group) as number)
  }
  return { rows, yx, yy, weights, groupIndex, groupIds }
}

function fitOnce(
  data: FlatData,
  lambda: number,
): { wx: number[]; wy: number[]; st: Standardization; X: number[][] } {
  const st = computeStandardization(data.rows, data.weights)
  const X = data.rows.map((r) => standardizeRow(r, st))
  const { wx, wy } = ridgeSolve(X, data.yx, data.yy, data.weights, lambda)
  return { wx, wy, st, X }
}

/** Leave-one-group-out CV over the lambda grid; returns the best lambda. */
function selectLambda(data: FlatData): number {
  const st = computeStandardization(data.rows, data.weights)
  const X = data.rows.map((r) => standardizeRow(r, st))
  const nGroups = data.groupIds.length

  let bestLambda: number | null = null
  let bestScore = Infinity
  for (const lambda of LAMBDA_GRID) {
    let total = 0
    let ok = true
    for (let held = 0; held < nGroups; held++) {
      const trainIdx: number[] = []
      const testIdx: number[] = []
      for (let k = 0; k < X.length; k++) {
        ;(data.groupIndex[k] === held ? testIdx : trainIdx).push(k)
      }
      if (testIdx.length === 0 || trainIdx.length === 0) continue
      try {
        const { wx, wy } = ridgeSolve(
          trainIdx.map((k) => X[k] as number[]),
          trainIdx.map((k) => data.yx[k] as number),
          trainIdx.map((k) => data.yy[k] as number),
          trainIdx.map((k) => data.weights[k] as number),
          lambda,
        )
        let errSum = 0
        for (const k of testIdx) {
          const p = predictRow(X[k] as number[], wx, wy)
          errSum += Math.hypot(p.x - (data.yx[k] as number), p.y - (data.yy[k] as number))
        }
        total += errSum / testIdx.length
      } catch {
        ok = false
        break
      }
    }
    if (ok) {
      const score = total / nGroups
      if (score < bestScore) {
        bestScore = score
        bestLambda = lambda
      }
    }
  }
  if (bestLambda === null) {
    throw new Error('Cross-validation failed for every lambda — degenerate calibration data')
  }
  return bestLambda
}

/**
 * Fit the gaze model on pursuit-calibration samples. Throws when the data
 * cannot support a trustworthy fit (too few segments, no spatial spread,
 * excessive noise) — callers must route the user back to calibration.
 */
export function fitGazeModelFromSamples(samples: CalibrationSample[]): FitResult {
  // Per-group cleanup: MAD-trim stationary segments (their features should
  // be constant, so deviants are blinks/glances); transits vary legitimately
  // and are cleaned by the residual prune instead.
  const byGroup = new Map<string, CalibrationSample[]>()
  for (const s of samples) {
    const arr = byGroup.get(s.group)
    if (arr) {
      arr.push(s)
    } else {
      byGroup.set(s.group, [s])
    }
  }

  const cleaned: CalibrationSample[] = []
  let dwellGroupCount = 0
  const dwellPositions = new Set<string>()
  let usedGroups = 0
  for (const groupSamples of byGroup.values()) {
    const kind = (groupSamples[0] as CalibrationSample).kind
    let kept = groupSamples
    if (kind !== 'transit') {
      const keptFeatures = new Set(trimPointSamples(groupSamples.map((s) => s.features)))
      kept = groupSamples.filter((s) => keptFeatures.has(s.features))
    }
    if (kept.length < MIN_SAMPLES_PER_GROUP[kind]) continue
    usedGroups++
    if (kind === 'dwell') {
      dwellGroupCount++
      const first = kept[0] as CalibrationSample
      dwellPositions.add(`${Math.round(first.screenX / 80)}:${Math.round(first.screenY / 80)}`)
    }
    cleaned.push(...kept)
  }

  if (usedGroups < MIN_GROUPS) {
    throw new Error(
      `Calibration produced only ${usedGroups} usable segments (need >= ${MIN_GROUPS})`,
    )
  }
  if (dwellGroupCount < MIN_DISTINCT_DWELL_POSITIONS || dwellPositions.size < MIN_DISTINCT_DWELL_POSITIONS) {
    throw new Error(
      `Calibration produced only ${dwellPositions.size} distinct dwell targets (need >= ${MIN_DISTINCT_DWELL_POSITIONS})`,
    )
  }
  if (cleaned.length < MIN_TOTAL_SAMPLES) {
    throw new Error(
      `Calibration produced only ${cleaned.length} usable samples (need >= ${MIN_TOTAL_SAMPLES})`,
    )
  }
  const xs = cleaned.map((s) => s.screenX)
  const ys = cleaned.map((s) => s.screenY)
  if (
    Math.max(...xs) - Math.min(...xs) < MIN_LABEL_SPAN_X_PX ||
    Math.max(...ys) - Math.min(...ys) < MIN_LABEL_SPAN_Y_PX
  ) {
    throw new Error('Calibration targets did not span the screen — degenerate label spread')
  }

  // Pass 1: lambda by leave-one-segment-out CV, then a full fit
  const data1 = flatten(cleaned)
  const lambda = selectLambda(data1)
  const pass1 = fitOnce(data1, lambda)

  // Residual prune: moments where the eye demonstrably wasn't on the dot
  const residuals = pass1.X.map((row, k) => {
    const p = predictRow(row, pass1.wx, pass1.wy)
    return Math.hypot(p.x - (data1.yx[k] as number), p.y - (data1.yy[k] as number))
  })
  let threshold = Math.max(PRUNE_MIN_PX, PRUNE_MEDIAN_MULTIPLE * median(residuals))
  const sortedResiduals = [...residuals].sort((a, b) => a - b)
  const maxDropThreshold = sortedResiduals[
    Math.floor(sortedResiduals.length * (1 - PRUNE_MAX_FRACTION))
  ] as number
  // Never drop more than PRUNE_MAX_FRACTION of the data
  threshold = Math.max(threshold, maxDropThreshold)

  const keptSamples = cleaned.filter((_, k) => (residuals[k] as number) <= threshold)
  const prunedSamples = cleaned.length - keptSamples.length
  if (keptSamples.length < MIN_SAMPLES_AFTER_PRUNE) {
    throw new Error('Calibration too noisy — most samples were rejected as outliers')
  }

  // Pass 2: refit on the kept samples (standardization and per-group
  // weights recomputed for the surviving set)
  const data2 = flatten(keptSamples)
  const pass2 = fitOnce(data2, lambda)
  const { wx, wy, st, X } = pass2

  for (const v of [...wx, ...wy]) {
    if (!Number.isFinite(v)) throw new Error('Non-finite coefficients in gaze model fit')
  }

  let sq = 0
  for (let k = 0; k < X.length; k++) {
    const p = predictRow(X[k] as number[], wx, wy)
    const w = data2.weights[k] as number
    sq += w * (Math.pow(p.x - (data2.yx[k] as number), 2) + Math.pow(p.y - (data2.yy[k] as number), 2))
  }
  const wSum = data2.weights.reduce((a, b) => a + b, 0)
  const trainRmsePx = Math.sqrt(sq / wSum)

  return {
    weightsX: wx,
    weightsY: wy,
    featMean: st.mean,
    featStd: st.std,
    lambda,
    trainRmsePx,
    usedGroups: data2.groupIds.length,
    usedSamples: keptSamples.length,
    prunedSamples,
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
 * hand-edited model must be rejected, not crash the gaze loop. Older model
 * versions (different feature space) are rejected too: recalibration is the
 * only safe migration.
 */
export function isValidGazeModel(data: unknown): data is GazeModel {
  const m = data as Partial<GazeModel> | null | undefined
  if (!m || m.version !== 3) return false
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
