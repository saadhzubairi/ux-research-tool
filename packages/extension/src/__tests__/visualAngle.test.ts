import { describe, it, expect } from 'vitest'
import {
  pxPerMmFromDiagonal,
  estimateViewingDistanceMm,
  pxPerDegree,
  degToPx,
  pxToDeg,
  derivePhysicalScreen,
  MM_PER_INCH,
  FIXATION_DISPERSION_THRESHOLD_DEG,
  FIXATION_DISPERSION_THRESHOLD_PX,
} from '@gazekit/shared'

describe('pxPerMmFromDiagonal', () => {
  it('computes px/mm for a 24" 1920x1080 monitor', () => {
    // diagonal = 2202.9px over 609.6mm
    const v = pxPerMmFromDiagonal(1920, 1080, 24)
    expect(v).toBeCloseTo(3.61, 2)
  })

  it('computes px/mm for a 14" MacBook Pro (CSS px)', () => {
    const v = pxPerMmFromDiagonal(1512, 982, 14.2)
    expect(v).toBeCloseTo(5.0, 1)
  })

  it('returns null for degenerate input', () => {
    expect(pxPerMmFromDiagonal(0, 1080, 24)).toBeNull()
    expect(pxPerMmFromDiagonal(1920, -1, 24)).toBeNull()
    expect(pxPerMmFromDiagonal(1920, 1080, 0)).toBeNull()
    expect(pxPerMmFromDiagonal(1920, 1080, NaN)).toBeNull()
  })
})

describe('estimateViewingDistanceMm', () => {
  it('estimates a plausible desk distance from a typical inter-ocular fraction', () => {
    // 63mm IPD, 60 deg hFOV: f = 0.5/tan(30deg) = 0.866 frame-widths
    // 0.09 frame-width inter-ocular -> 63 * 0.866 / 0.09 = ~606mm
    const v = estimateViewingDistanceMm(0.09)
    expect(v).toBeCloseTo(606, 0)
  })

  it('clamps implausibly near and far estimates', () => {
    expect(estimateViewingDistanceMm(0.5)).toBe(300) // raw ~109mm
    expect(estimateViewingDistanceMm(0.02)).toBe(1200) // raw ~2728mm
  })

  it('returns null for degenerate input', () => {
    expect(estimateViewingDistanceMm(0)).toBeNull()
    expect(estimateViewingDistanceMm(-0.1)).toBeNull()
    expect(estimateViewingDistanceMm(1.5)).toBeNull()
    expect(estimateViewingDistanceMm(NaN)).toBeNull()
    expect(estimateViewingDistanceMm(0.09, 0)).toBeNull()
    expect(estimateViewingDistanceMm(0.09, 180)).toBeNull()
  })
})

describe('pxPerDegree / degToPx / pxToDeg', () => {
  it('1 degree at 600mm on a ~5px/mm screen is ~52px', () => {
    // 600 * tan(1 deg) = 10.47mm per degree
    const v = pxPerDegree(600, 5)
    expect(v).toBeCloseTo(52.4, 1)
  })

  it('deg<->px round-trips', () => {
    const pxPerDeg = pxPerDegree(650, 4.2)
    expect(pxToDeg(degToPx(1.7, pxPerDeg), pxPerDeg)).toBeCloseTo(1.7, 10)
  })

  it('degree-based fixation threshold matches the px default at laptop geometry', () => {
    // The 50px I-DT default was tuned on a laptop (~52px/deg) — the degree
    // threshold must reproduce it there, or fixation counts jump on upgrade
    const laptopPxPerDeg = pxPerDegree(600, 5)
    const thresholdPx = degToPx(FIXATION_DISPERSION_THRESHOLD_DEG, laptopPxPerDeg)
    expect(
      Math.abs(thresholdPx - FIXATION_DISPERSION_THRESHOLD_PX),
    ).toBeLessThan(10)
  })
})

describe('derivePhysicalScreen', () => {
  it('bundles a consistent physical context on the happy path', () => {
    const p = derivePhysicalScreen(1512, 982, 14.2, 0.09)
    expect(p).not.toBeNull()
    expect(p!.screenDiagonalMm).toBeCloseTo(14.2 * MM_PER_INCH, 6)
    expect(p!.pxPerMm).toBeCloseTo(5.0, 1)
    expect(p!.viewingDistanceMm).toBeCloseTo(606, 0)
    // ~53px per degree on a 14" laptop at ~60cm
    expect(p!.pxPerDeg).toBeGreaterThan(45)
    expect(p!.pxPerDeg).toBeLessThan(60)
  })

  it('a 27" 4K-scaled monitor yields larger px-per-degree at the same distance', () => {
    const laptop = derivePhysicalScreen(1512, 982, 14.2, 0.09)
    const monitor = derivePhysicalScreen(2560, 1440, 27, 0.09)
    expect(monitor!.pxPerMm).toBeGreaterThan(4)
    expect(monitor!.pxPerDeg).toBeGreaterThan(laptop!.pxPerDeg * 0.8)
  })

  it('propagates null from either estimate', () => {
    expect(derivePhysicalScreen(1920, 1080, 0, 0.09)).toBeNull()
    expect(derivePhysicalScreen(1920, 1080, 24, 0)).toBeNull()
    expect(derivePhysicalScreen(NaN, 1080, 24, 0.09)).toBeNull()
  })
})
