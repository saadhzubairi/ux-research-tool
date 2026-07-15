import { describe, it, expect } from 'vitest'
import { detectFixations } from '@gazekit/shared'
import type { GazeSample } from '@gazekit/shared'

function samplesAt(
  x: number,
  y: number,
  startTs: number,
  count: number,
  intervalMs = 33,
): GazeSample[] {
  return Array.from({ length: count }, (_, i) => ({
    x: x + (i % 3), // tiny jitter
    y: y + ((i + 1) % 3),
    ts: startTs + i * intervalMs,
    conf: 1,
  }))
}

describe('detectFixations gap handling', () => {
  it('detects a simple fixation', () => {
    const fixations = detectFixations(samplesAt(500, 400, 0, 15))
    expect(fixations.length).toBe(1)
    expect(fixations[0]!.x).toBeCloseTo(501, 0)
    expect(fixations[0]!.durationMs).toBeGreaterThanOrEqual(100)
  })

  it('does not merge two fixations at the same spot across a long gap', () => {
    const first = samplesAt(500, 400, 0, 15)
    // Same location again, 10 seconds later (tab switch / tracking loss)
    const second = samplesAt(500, 400, 10_000, 15)

    const fixations = detectFixations([...first, ...second])

    expect(fixations.length).toBe(2)
    // Neither fixation's duration may span the gap
    for (const f of fixations) {
      expect(f.durationMs).toBeLessThan(1000)
    }
  })

  it('splits on gaps even mid-fixation', () => {
    const a = samplesAt(500, 400, 0, 10)
    const b = samplesAt(500, 400, a[a.length - 1]!.ts + 500, 10) // 500ms dropout
    const fixations = detectFixations([...a, ...b])
    for (const f of fixations) {
      expect(f.durationMs).toBeLessThan(500)
    }
  })

  it('separates spatially distinct fixations', () => {
    const a = samplesAt(200, 200, 0, 15)
    const b = samplesAt(900, 700, a[a.length - 1]!.ts + 33, 15)
    const fixations = detectFixations([...a, ...b])
    expect(fixations.length).toBe(2)
  })
})
