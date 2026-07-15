import { describe, it, expect } from 'vitest'
import {
  fitGazeModel,
  predictScreenPx,
  trimPointSamples,
  isValidGazeModel,
  type CalibrationPointData,
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

/**
 * Build synthetic calibration data where screen position is a known linear
 * function of two feature dimensions (iris x/y), with the other features
 * held near-constant plus noise.
 */
function syntheticPoints(
  rng: () => number,
  noise = 0.001,
  samplesPerPoint = 20,
): { points: CalibrationPointData[]; predictAt: (fx: number, fy: number) => number[] } {
  const targets: Array<[number, number]> = [
    [0.1, 0.1], [0.5, 0.1], [0.9, 0.1],
    [0.1, 0.5], [0.5, 0.5], [0.9, 0.5],
    [0.1, 0.9], [0.5, 0.9], [0.9, 0.9],
    [0.3, 0.3], [0.7, 0.7],
  ]
  const SCREEN_W = 1920
  const SCREEN_H = 1080

  const featuresFor = (fx: number, fy: number): number[] => {
    const f = new Array(FEATURE_COUNT).fill(0)
    f[0] = fx * 0.1 // irisLx
    f[1] = fy * 0.05 // irisLy
    f[2] = fx * 0.1 + 0.01 // irisRx
    f[3] = fy * 0.05 - 0.01 // irisRy
    f[4] = 0.08 // lidGapL (constant)
    f[5] = 0.08 // lidGapR (constant)
    f[13] = 0.15 // interocular (constant)
    return f
  }

  const points = targets.map(([tx, ty]) => ({
    screenX: tx * SCREEN_W,
    screenY: ty * SCREEN_H,
    samples: Array.from({ length: samplesPerPoint }, () =>
      featuresFor(tx, ty).map((v) => v + (rng() - 0.5) * noise),
    ),
  }))

  return { points, predictAt: featuresFor }
}

describe('fitGazeModel', () => {
  it('recovers a linear feature->screen mapping with low error', () => {
    const rng = makeRng(42)
    const { points, predictAt } = syntheticPoints(rng)
    const fit = fitGazeModel(points)

    // Predict at a held-out interior location
    const pred = predictScreenPx(
      { weightsX: fit.weightsX, weightsY: fit.weightsY, featMean: fit.featMean, featStd: fit.featStd },
      predictAt(0.4, 0.6),
    )
    expect(pred.x).toBeCloseTo(0.4 * 1920, -2) // within ~50px
    expect(pred.y).toBeCloseTo(0.6 * 1080, -2)
    expect(fit.trainRmsePx).toBeLessThan(50)
  })

  it('produces finite weights and a lambda from the grid', () => {
    const rng = makeRng(7)
    const { points } = syntheticPoints(rng, 0.005)
    const fit = fitGazeModel(points)
    expect(fit.weightsX.every(Number.isFinite)).toBe(true)
    expect(fit.weightsY.every(Number.isFinite)).toBe(true)
    expect([1e-3, 1e-2, 1e-1, 1, 10]).toContain(fit.lambda)
  })

  it('excludes constant features via zero std', () => {
    const rng = makeRng(11)
    const { points } = syntheticPoints(rng, 0)
    const fit = fitGazeModel(points)
    // lid gaps and interocular were exactly constant -> excluded
    expect(fit.featStd[4]).toBe(0)
    expect(fit.featStd[5]).toBe(0)
    expect(fit.featStd[13]).toBe(0)

    // Runtime variation in an excluded feature must not affect predictions
    const f1 = new Array(FEATURE_COUNT).fill(0)
    const f2 = [...f1]
    f2[4] = 999
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

  it('throws when there are too few usable points', () => {
    const rng = makeRng(3)
    const { points } = syntheticPoints(rng)
    expect(() => fitGazeModel(points.slice(0, 3))).toThrow()
  })

  it('throws rather than fitting a single repeated point', () => {
    const rng = makeRng(5)
    const { points } = syntheticPoints(rng)
    expect(() => fitGazeModel([points[0]!])).toThrow()
  })
})

describe('trimPointSamples', () => {
  it('removes outlier samples in the core iris features', () => {
    const base = new Array(FEATURE_COUNT).fill(0.1)
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
    const base = new Array(FEATURE_COUNT).fill(0.1)
    const samples = Array.from({ length: 10 }, () => [...base])
    expect(trimPointSamples(samples).length).toBe(10)
  })
})

describe('isValidGazeModel', () => {
  it('accepts a freshly fitted model shape', () => {
    const rng = makeRng(19)
    const { points } = syntheticPoints(rng)
    const fit = fitGazeModel(points)
    const model = {
      version: 2,
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
    expect(isValidGazeModel(model)).toBe(true)
  })

  it('rejects a model missing runtime-dereferenced fields (calibBounds, refHeadPose)', () => {
    const rng = makeRng(23)
    const { points } = syntheticPoints(rng)
    const fit = fitGazeModel(points)
    const base = {
      version: 2,
      weightsX: fit.weightsX,
      weightsY: fit.weightsY,
      featMean: fit.featMean,
      featStd: fit.featStd,
      calibScreen: { width: 1920, height: 1080 },
      calibBounds: { left: 0, top: 0, right: 1920, bottom: 1080 },
      refHeadPose: { yaw: 0, pitch: 0, roll: 0 },
      refInterocular: 0.15,
    }
    expect(isValidGazeModel(base)).toBe(true)
    expect(isValidGazeModel({ ...base, calibBounds: undefined })).toBe(false)
    expect(isValidGazeModel({ ...base, refHeadPose: undefined })).toBe(false)
    expect(isValidGazeModel({ ...base, refInterocular: NaN })).toBe(false)
    expect(
      isValidGazeModel({ ...base, calibScreen: { width: 1920, height: NaN } }),
    ).toBe(false)
  })

  it('rejects v1 models, nulls, and NaN weights', () => {
    expect(isValidGazeModel(null)).toBe(false)
    expect(isValidGazeModel({ coeffsX: [1, 2], coeffsY: [1, 2] })).toBe(false)
    expect(
      isValidGazeModel({
        version: 2,
        weightsX: new Array(FEATURE_COUNT + 1).fill(NaN),
        weightsY: new Array(FEATURE_COUNT + 1).fill(0),
        featMean: new Array(FEATURE_COUNT).fill(0),
        featStd: new Array(FEATURE_COUNT).fill(1),
        calibScreen: { width: 1920, height: 1080 },
      }),
    ).toBe(false)
  })

  it('rejects a JSON-serialized model whose NaN became null', () => {
    const weights = new Array(FEATURE_COUNT + 1).fill(0)
    const roundTripped = JSON.parse(
      JSON.stringify({
        version: 2,
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
