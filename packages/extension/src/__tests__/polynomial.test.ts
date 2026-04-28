import { describe, it, expect } from 'vitest'
import {
  solvePolynomial,
  predictGaze,
  type CalibrationSample,
} from '../offscreen/polynomial'

describe('solvePolynomial', () => {
  it('fits a linear mapping exactly with 6 points', () => {
    const samples: CalibrationSample[] = [
      { irisX: 0.2, irisY: 0.2, screenX: 384, screenY: 216 },
      { irisX: 0.5, irisY: 0.2, screenX: 960, screenY: 216 },
      { irisX: 0.8, irisY: 0.2, screenX: 1536, screenY: 216 },
      { irisX: 0.5, irisY: 0.5, screenX: 960, screenY: 540 },
      { irisX: 0.2, irisY: 0.8, screenX: 384, screenY: 864 },
      { irisX: 0.8, irisY: 0.8, screenX: 1536, screenY: 864 },
    ]

    const model = solvePolynomial(samples)
    expect(model.coeffsX).toHaveLength(6)
    expect(model.coeffsY).toHaveLength(6)

    for (const s of samples) {
      const pred = predictGaze(model, s.irisX, s.irisY)
      expect(pred.x).toBeCloseTo(s.screenX, 0)
      expect(pred.y).toBeCloseTo(s.screenY, 0)
    }
  })

  it('interpolates between calibration points', () => {
    const samples: CalibrationSample[] = [
      { irisX: 0.0, irisY: 0.0, screenX: 0, screenY: 0 },
      { irisX: 1.0, irisY: 0.0, screenX: 1920, screenY: 0 },
      { irisX: 0.0, irisY: 1.0, screenX: 0, screenY: 1080 },
      { irisX: 1.0, irisY: 1.0, screenX: 1920, screenY: 1080 },
      { irisX: 0.5, irisY: 0.5, screenX: 960, screenY: 540 },
      { irisX: 0.5, irisY: 0.0, screenX: 960, screenY: 0 },
    ]

    const model = solvePolynomial(samples)
    const pred = predictGaze(model, 0.25, 0.25)
    expect(pred.x).toBeCloseTo(480, -1)
    expect(pred.y).toBeCloseTo(270, -1)
  })

  it('handles noisy samples via least-squares averaging', () => {
    const samples: CalibrationSample[] = [
      { irisX: 0.09, irisY: 0.10, screenX: 0, screenY: 0 },
      { irisX: 0.11, irisY: 0.10, screenX: 0, screenY: 0 },
      { irisX: 0.10, irisY: 0.09, screenX: 0, screenY: 0 },
      { irisX: 0.89, irisY: 0.10, screenX: 1920, screenY: 0 },
      { irisX: 0.91, irisY: 0.10, screenX: 1920, screenY: 0 },
      { irisX: 0.90, irisY: 0.09, screenX: 1920, screenY: 0 },
      { irisX: 0.10, irisY: 0.89, screenX: 0, screenY: 1080 },
      { irisX: 0.10, irisY: 0.91, screenX: 0, screenY: 1080 },
      { irisX: 0.09, irisY: 0.90, screenX: 0, screenY: 1080 },
      { irisX: 0.90, irisY: 0.90, screenX: 1920, screenY: 1080 },
      { irisX: 0.91, irisY: 0.91, screenX: 1920, screenY: 1080 },
      { irisX: 0.89, irisY: 0.89, screenX: 1920, screenY: 1080 },
      { irisX: 0.50, irisY: 0.50, screenX: 960, screenY: 540 },
      { irisX: 0.51, irisY: 0.49, screenX: 960, screenY: 540 },
      { irisX: 0.49, irisY: 0.51, screenX: 960, screenY: 540 },
      { irisX: 0.50, irisY: 0.10, screenX: 960, screenY: 0 },
      { irisX: 0.51, irisY: 0.09, screenX: 960, screenY: 0 },
      { irisX: 0.49, irisY: 0.11, screenX: 960, screenY: 0 },
    ]

    const model = solvePolynomial(samples)
    const center = predictGaze(model, 0.5, 0.5)
    expect(center.x).toBeCloseTo(960, -2)
    expect(center.y).toBeCloseTo(540, -2)
  })
})

describe('predictGaze', () => {
  it('evaluates the polynomial correctly', () => {
    const model = {
      coeffsX: [100, 200, 50, 10, 5, 3],
      coeffsY: [50, 30, 300, 8, 2, 7],
    }

    const origin = predictGaze(model, 0, 0)
    expect(origin.x).toBeCloseTo(100)
    expect(origin.y).toBeCloseTo(50)

    const right = predictGaze(model, 1, 0)
    expect(right.x).toBeCloseTo(305)
  })
})
