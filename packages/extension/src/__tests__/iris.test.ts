import { describe, it, expect } from 'vitest'
import { normalizeIrisPosition, type IrisData } from '../offscreen/iris'

describe('normalizeIrisPosition', () => {
  function centered(): IrisData {
    return {
      leftIrisCenter: { x: 0.60, y: 0.35, z: 0 },
      rightIrisCenter: { x: 0.40, y: 0.35, z: 0 },
      leftOuterCorner: { x: 0.65, y: 0.35, z: 0 },
      leftInnerCorner: { x: 0.55, y: 0.35, z: 0 },
      rightOuterCorner: { x: 0.35, y: 0.35, z: 0 },
      rightInnerCorner: { x: 0.45, y: 0.35, z: 0 },
      leftUpperEyelid: { x: 0.60, y: 0.32, z: 0 },
      leftLowerEyelid: { x: 0.60, y: 0.38, z: 0 },
      rightUpperEyelid: { x: 0.40, y: 0.32, z: 0 },
      rightLowerEyelid: { x: 0.40, y: 0.38, z: 0 },
    }
  }

  it('returns ~0.5 when iris is centered in both eyes', () => {
    const result = normalizeIrisPosition(centered())
    expect(result.x).toBeCloseTo(0.5, 1)
    expect(result.y).toBeCloseTo(0.5, 1)
  })

  it('produces consistent x when both eyes look right', () => {
    const data = centered()
    data.leftIrisCenter = { x: 0.63, y: 0.35, z: 0 }
    data.rightIrisCenter = { x: 0.43, y: 0.35, z: 0 }

    const result = normalizeIrisPosition(data)
    expect(result.x).toBeGreaterThan(0.5)
  })

  it('produces consistent x when both eyes look left', () => {
    const data = centered()
    data.leftIrisCenter = { x: 0.57, y: 0.35, z: 0 }
    data.rightIrisCenter = { x: 0.37, y: 0.35, z: 0 }

    const result = normalizeIrisPosition(data)
    expect(result.x).toBeLessThan(0.5)
  })

  it('uses eyelids for vertical normalization', () => {
    const data = centered()
    data.leftIrisCenter = { x: 0.60, y: 0.33, z: 0 }
    data.rightIrisCenter = { x: 0.40, y: 0.33, z: 0 }

    const result = normalizeIrisPosition(data)
    expect(result.y).toBeLessThan(0.5)
  })

  it('handles right eye corner reversal via min/max', () => {
    const data = centered()
    const result = normalizeIrisPosition(data)
    expect(result.x).toBeCloseTo(0.5, 1)
    expect(Number.isFinite(result.x)).toBe(true)
    expect(Number.isFinite(result.y)).toBe(true)
  })
})
