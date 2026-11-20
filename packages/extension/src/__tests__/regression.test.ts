import { describe, it, expect } from 'vitest'
import {
  fitGazeModelFromSamples,
  predictScreenPx,
  trimPointSamples,
  isValidGazeModel,
  type CalibrationSample,
} from '../offscreen/regression'
import { FEATURE_COUNT } from '../offscreen/features'

// Deterministic pseudo-random generator so tests are reproducible
function makeRng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const SCREEN_W = 1920
const SCREEN_H = 1080

/**
 * Ground-truth features for a normalized gaze target: screen position is a
 * linear function of the iris features, everything else held constant.
 */
function featuresFor(tx: number, ty: number): number[] {
  const f = new Array<number>(FEATURE_COUNT).fill(0)
  f[0] = tx * 0.1 // irisLx
  f[1] = ty * 0.05 // irisLy
  f[2] = tx * 0.1 + 0.01 // irisRx
  f[3] = ty * 0.05 - 0.01 // irisRy
  f[5] = 0.08 // lidGapL (constant)
  f[6] = 0.08 // lidGapR (constant)
  f[12] = -45 // headTz (constant)
  return f
}

interface GenOptions {
  noise?: number
  corruptTransitSamples?: number
}

/**
 * Build a synthetic pursuit calibration: dwells at the four corners +
 * center, four transits with per-sample moving labels, and a vor group at
 * the center with varying head-yaw.
 */
function syntheticSamples(rng: () => number, opts: GenOptions = {}): CalibrationSample[] {
  const noise = opts.noise ?? 0.001
  const samples: CalibrationSample[] = []

  const jitter = (f: number[]): number[] => f.map((v) => v + (rng() - 0.5) * noise)

  const dwells: Array<[number, number]> = [
    [0.06, 0.08],
    [0.94, 0.08],
    [0.06, 0.92],
    [0.94, 0.92],
    [0.5, 0.5],
  ]
  dwells.forEach(([tx, ty], i) => {
    for (let k = 0; k < 15; k++) {
      samples.push({
        screenX: tx * SCREEN_W,
        screenY: ty * SCREEN_H,
        features: jitter(featuresFor(tx, ty)),
        group: `dwell-${i}`,
        kind: 'dwell',
      })
    }
  })

  const transits: Array<[[number, number], [number, number]]> = [
    [[0.5, 0.5], [0.06, 0.08]],
    [[0.06, 0.08], [0.94, 0.08]],
    [[0.94, 0.08], [0.5, 0.5]],
    [[0.5, 0.5], [0.94, 0.92]],
  ]
  transits.forEach(([from, to], i) => {
    for (let k = 0; k < 20; k++) {
      const u = k / 19
      const tx = from[0] + (to[0] - from[0]) * u
      const ty = from[1] + (to[1] - from[1]) * u
      const corrupt = i === 1 && k < (opts.corruptTransitSamples ?? 0)
      samples.push({
        screenX: tx * SCREEN_W,
        screenY: ty * SCREEN_H,
        // A corrupted sample: the eye was actually parked at the bottom-left
        // corner while the label says the dot position
        features: jitter(featuresFor(corrupt ? 0.06 : tx, corrupt ? 0.92 : ty)),
        group: `transit-${i}`,
        kind: 'transit',
      })
    }
  })

  // Vor: label constant at center, head yaw swinging
  for (let k = 0; k < 15; k++) {
    const f = jitter(featuresFor(0.5, 0.5))
    f[7] = Math.sin((k / 14) * Math.PI * 2) * 0.3 // yaw sweep
    samples.push({
      screenX: 0.5 * SCREEN_W,
      screenY: 0.5 * SCREEN_H,
      features: f,
      group: 'vor-lr',
      kind: 'vor',
    })
  }

  return samples
}

describe('fitGazeModelFromSamples', () => {
  it('recovers a linear feature->screen mapping with low error', () => {
    const rng = makeRng(42)
    const fit = fitGazeModelFromSamples(syntheticSamples(rng))

    // Predict at a held-out interior location
    const pred = predictScreenPx(
      { weightsX: fit.weightsX, weightsY: fit.weightsY, featMean: fit.featMean, featStd: fit.featStd },
      featuresFor(0.4, 0.6),
    )
    expect(pred.x).toBeCloseTo(0.4 * SCREEN_W, -2) // within ~50px
    expect(pred.y).toBeCloseTo(0.6 * SCREEN_H, -2)
    expect(fit.trainRmsePx).toBeLessThan(50)
    expect(fit.usedGroups).toBeGreaterThanOrEqual(8)
  })

  it('honors per-sample moving labels from transits', () => {
    const rng = makeRng(7)
    const fit = fitGazeModelFromSamples(syntheticSamples(rng))
    // Mid-point of the top-edge transit — never a dwell target
    const pred = predictScreenPx(
      { weightsX: fit.weightsX, weightsY: fit.weightsY, featMean: fit.featMean, featStd: fit.featStd },
      featuresFor(0.5, 0.08),
    )
    expect(pred.x).toBeCloseTo(0.5 * SCREEN_W, -2)
    expect(pred.y).toBeCloseTo(0.08 * SCREEN_H, -2)
  })

  it('prunes samples where the eye was not tracking the dot', () => {
    const rng = makeRng(13)
    const fit = fitGazeModelFromSamples(syntheticSamples(rng, { corruptTransitSamples: 8 }))
    expect(fit.prunedSamples).toBeGreaterThanOrEqual(6)

    // Accuracy survives the corruption
    const pred = predictScreenPx(
      { weightsX: fit.weightsX, weightsY: fit.weightsY, featMean: fit.featMean, featStd: fit.featStd },
      featuresFor(0.4, 0.6),
    )
    expect(pred.x).toBeCloseTo(0.4 * SCREEN_W, -2)
    expect(pred.y).toBeCloseTo(0.6 * SCREEN_H, -2)
  })

  it('produces finite weights and a lambda from the grid', () => {
    const rng = makeRng(3)
    const fit = fitGazeModelFromSamples(syntheticSamples(rng, { noise: 0.005 }))
    expect(fit.weightsX.every(Number.isFinite)).toBe(true)
    expect(fit.weightsY.every(Number.isFinite)).toBe(true)
    expect([1e-3, 1e-2, 1e-1, 1, 10]).toContain(fit.lambda)
  })

  it('excludes constant features via zero std', () => {
    const rng = makeRng(11)
    const fit = fitGazeModelFromSamples(syntheticSamples(rng, { noise: 0 }))
    // lid gaps and headTz were exactly constant -> excluded
    expect(fit.featStd[5]).toBe(0)
    expect(fit.featStd[6]).toBe(0)
    expect(fit.featStd[12]).toBe(0)

    // Runtime variation in an excluded feature must not affect predictions
    const f1 = new Array<number>(FEATURE_COUNT).fill(0)
    const f2 = [...f1]
    f2[5] = 999
    const model = {
      weightsX: fit.weightsX,
      weightsY: fit.weightsY,
      featMean: fit.featMean,
      featStd: fit.featStd,
    }
    const p1 = predictScreenPx(model, f1)
    const p2 = predictScreenPx(model, f2)
    expect(p1.x).toBe(p2.x)
    expect(p1.y).toBe(p2.y)
  })

  it('throws when too few segments are usable', () => {
    const rng = makeRng(5)
    const samples = syntheticSamples(rng).filter(
      (s) => s.group === 'dwell-0' || s.group === 'dwell-1' || s.group === 'transit-1',
    )
    expect(() => fitGazeModelFromSamples(samples)).toThrow()
  })

  it('throws when all dwell targets collapse to one position', () => {
    const rng = makeRng(17)
    const samples = syntheticSamples(rng).map((s) =>
      s.kind === 'dwell'
        ? { ...s, screenX: 0.5 * SCREEN_W, screenY: 0.5 * SCREEN_H, features: featuresFor(0.5, 0.5) }
        : s,
    )
    expect(() => fitGazeModelFromSamples(samples)).toThrow(/distinct dwell targets/)
  })

  it('throws on an empty sample set', () => {
    expect(() => fitGazeModelFromSamples([])).toThrow()
  })
})

describe('trimPointSamples', () => {
  it('removes outlier samples in the core iris features', () => {
    const base = new Array<number>(FEATURE_COUNT).fill(0.1)
    const samples = Array.from({ length: 20 }, (_, i) =>
      base.map((v, j) => (j < 4 ? v + (i % 5) * 1e-4 : v)),
    )
    const outlier = [...base]
    outlier[0] = 5 // wild iris x — e.g. a blink glitch
    samples.push(outlier)

    const trimmed = trimPointSamples(samples)
    expect(trimmed.length).toBe(20)
    expect(trimmed).not.toContainEqual(outlier)
  })

  it('keeps everything when samples are tight', () => {
    const base = new Array<number>(FEATURE_COUNT).fill(0.1)
    const samples = Array.from({ length: 10 }, () => [...base])
    expect(trimPointSamples(samples).length).toBe(10)
  })
})

describe('isValidGazeModel', () => {
  function fittedModelBase() {
    const rng = makeRng(19)
    const fit = fitGazeModelFromSamples(syntheticSamples(rng))
    return {
      version: 3,
      weightsX: fit.weightsX,
      weightsY: fit.weightsY,
      featMean: fit.featMean,
      featStd: fit.featStd,
      lambda: fit.lambda,
      trainRmsePx: fit.trainRmsePx,
      calibScreen: { width: 1920, height: 1080 },
      calibBounds: { left: 115, top: 86, right: 1805, bottom: 994 },
      calibWindow: {
        screenX: 0, screenY: 0, outerWidth: 1920, outerHeight: 1080,
        innerWidth: 1920, innerHeight: 990, zoom: 1,
      },
      refHeadPose: { yaw: 0, pitch: 0, roll: 0 },
      refInterocular: 0.15,
      cameraDeviceId: null,
      cameraSize: { width: 1280, height: 720 },
      calibratedAt: new Date().toISOString(),
      validation: null,
    }
  }

  it('accepts a freshly fitted model shape', () => {
    expect(isValidGazeModel(fittedModelBase())).toBe(true)
  })

  it('rejects a model missing runtime-dereferenced fields (calibBounds, refHeadPose)', () => {
    const base = fittedModelBase()
    expect(isValidGazeModel({ ...base, calibBounds: undefined })).toBe(false)
    expect(isValidGazeModel({ ...base, refHeadPose: undefined })).toBe(false)
    expect(isValidGazeModel({ ...base, refInterocular: NaN })).toBe(false)
    expect(
      isValidGazeModel({ ...base, calibScreen: { width: 1920, height: NaN } }),
    ).toBe(false)
  })

  it('rejects older model versions, nulls, and NaN weights', () => {
    expect(isValidGazeModel(null)).toBe(false)
    expect(isValidGazeModel({ coeffsX: [1, 2], coeffsY: [1, 2] })).toBe(false)
    // A v2 model (17-feature space) must be rejected — different features
    expect(isValidGazeModel({ ...fittedModelBase(), version: 2 })).toBe(false)
    expect(
      isValidGazeModel({
        version: 3,
        weightsX: new Array(FEATURE_COUNT + 1).fill(NaN),
        weightsY: new Array(FEATURE_COUNT + 1).fill(0),
        featMean: new Array(FEATURE_COUNT).fill(0),
        featStd: new Array(FEATURE_COUNT).fill(1),
        calibScreen: { width: 1920, height: 1080 },
      }),
    ).toBe(false)
  })

  it('rejects a JSON-serialized model whose NaN became null', () => {
    const weights = new Array<number>(FEATURE_COUNT + 1).fill(0)
    const roundTripped: unknown = JSON.parse(
      JSON.stringify({
        version: 3,
        weightsX: weights.map((_, i) => (i === 0 ? NaN : 0)),
        weightsY: weights,
        featMean: new Array(FEATURE_COUNT).fill(0),
        featStd: new Array(FEATURE_COUNT).fill(1),
        calibScreen: { width: 1920, height: 1080 },
      }),
    )
    expect(isValidGazeModel(roundTripped)).toBe(false)
  })
})
