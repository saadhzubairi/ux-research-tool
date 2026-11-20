import { describe, it, expect } from 'vitest'
import {
  buildPursuitTimeline,
  dotPositionAt,
  sampleAt,
  segmentAt,
  PURSUIT_LAG_MS,
  DWELL_DISCARD_MS,
  TRANSIT_DISCARD_MS,
} from '../calibration/pursuitPath'

const ASPECT = 16 / 9

describe('buildPursuitTimeline', () => {
  it('produces contiguous segments that sum to the total duration', () => {
    const tl = buildPursuitTimeline(ASPECT)
    expect(tl.segments.length).toBeGreaterThan(0)
    expect(tl.segments[0]!.startMs).toBe(0)
    for (let i = 1; i < tl.segments.length; i++) {
      expect(tl.segments[i]!.startMs).toBe(tl.segments[i - 1]!.endMs)
    }
    expect(tl.segments[tl.segments.length - 1]!.endMs).toBe(tl.totalMs)
  })

  it('covers all four corners with dwells and ends with two vor phases', () => {
    const tl = buildPursuitTimeline(ASPECT)
    const dwellPositions = tl.segments
      .filter((s) => s.kind === 'dwell')
      .map((s) => `${s.from.x},${s.from.y}`)
    for (const corner of ['0.06,0.08', '0.94,0.08', '0.06,0.92', '0.94,0.92']) {
      expect(dwellPositions).toContain(corner)
    }

    const vor = tl.segments.filter((s) => s.kind === 'vor')
    expect(vor.map((s) => s.id)).toEqual(['vor-lr', 'vor-ud'])
    for (const s of vor) {
      expect(s.startMs).toBeGreaterThanOrEqual(tl.pursuitMs)
      expect(s.from).toEqual({ x: 0.5, y: 0.5 })
    }
    // The whole flow stays comfortably under half a minute
    expect(tl.totalMs).toBeLessThan(30_000)
  })

  it('gives horizontal transits more time on wider screens', () => {
    const wide = buildPursuitTimeline(21 / 9)
    const square = buildPursuitTimeline(1)
    const topEdge = (tl: typeof wide) =>
      tl.segments.find(
        (s) => s.kind === 'transit' && s.from.y === s.to.y && Math.abs(s.to.x - s.from.x) > 0.5,
      )!
    const wideDur = topEdge(wide).endMs - topEdge(wide).startMs
    const squareDur = topEdge(square).endMs - topEdge(square).startMs
    expect(wideDur).toBeGreaterThan(squareDur)
  })
})

describe('dotPositionAt', () => {
  it('holds the anchor during dwells and interpolates transits end-to-end', () => {
    const tl = buildPursuitTimeline(ASPECT)
    for (const seg of tl.segments) {
      const mid = (seg.startMs + seg.endMs) / 2
      const atMid = dotPositionAt(tl, mid)
      if (seg.kind !== 'transit') {
        expect(atMid).toEqual(seg.from)
      } else {
        const atStart = dotPositionAt(tl, seg.startMs)
        const atEnd = dotPositionAt(tl, seg.endMs - 0.001)
        expect(atStart.x).toBeCloseTo(seg.from.x, 6)
        expect(atStart.y).toBeCloseTo(seg.from.y, 6)
        expect(atEnd.x).toBeCloseTo(seg.to.x, 3)
        expect(atEnd.y).toBeCloseTo(seg.to.y, 3)
      }
    }
  })

  it('progresses monotonically along a transit', () => {
    const tl = buildPursuitTimeline(ASPECT)
    const transit = tl.segments.find((s) => s.kind === 'transit')!
    let lastDist = -1
    for (let t = transit.startMs; t <= transit.endMs; t += 25) {
      const p = dotPositionAt(tl, t)
      const dist = Math.hypot(p.x - transit.from.x, p.y - transit.from.y)
      expect(dist).toBeGreaterThanOrEqual(lastDist)
      lastDist = dist
    }
  })

  it('clamps outside the timeline', () => {
    const tl = buildPursuitTimeline(ASPECT)
    expect(dotPositionAt(tl, -100)).toEqual({ x: 0.5, y: 0.5 })
    expect(dotPositionAt(tl, tl.totalMs + 5000)).toEqual({ x: 0.5, y: 0.5 })
  })
})

describe('sampleAt', () => {
  it('returns null before the lagged clock starts and after the end', () => {
    const tl = buildPursuitTimeline(ASPECT)
    expect(sampleAt(tl, PURSUIT_LAG_MS - 1)).toBeNull()
    expect(sampleAt(tl, tl.totalMs + PURSUIT_LAG_MS + 1)).toBeNull()
  })

  it('rejects samples inside discard windows and accepts steady-state ones', () => {
    const tl = buildPursuitTimeline(ASPECT)
    const dwell = tl.segments[0]! // initial center dwell

    const early = sampleAt(tl, dwell.startMs + PURSUIT_LAG_MS + DWELL_DISCARD_MS - 20)!
    expect(early.record).toBe(false)

    const steady = sampleAt(tl, dwell.startMs + PURSUIT_LAG_MS + DWELL_DISCARD_MS + 50)!
    expect(steady.record).toBe(true)
    expect(steady.group).toBe(dwell.id)
    expect(steady.kind).toBe('dwell')
    expect(steady.x).toBe(0.5)
    expect(steady.y).toBe(0.5)
  })

  it('labels transit samples with the pursuit-lagged dot position', () => {
    const tl = buildPursuitTimeline(ASPECT)
    const transit = tl.segments.find((s) => s.kind === 'transit')!
    const tMid = (transit.startMs + transit.endMs) / 2 + PURSUIT_LAG_MS

    const spec = sampleAt(tl, tMid)!
    expect(spec.kind).toBe('transit')
    expect(spec.group).toBe(transit.id)
    const expected = dotPositionAt(tl, tMid - PURSUIT_LAG_MS)
    expect(spec.x).toBeCloseTo(expected.x, 9)
    expect(spec.y).toBeCloseTo(expected.y, 9)
    // Strictly between the endpoints
    const distFrom = Math.hypot(spec.x - transit.from.x, spec.y - transit.from.y)
    const total = Math.hypot(transit.to.x - transit.from.x, transit.to.y - transit.from.y)
    expect(distFrom).toBeGreaterThan(0)
    expect(distFrom).toBeLessThan(total)
  })

  it('attributes frames just after a segment change to the PREVIOUS segment', () => {
    const tl = buildPursuitTimeline(ASPECT)
    const second = tl.segments[1]! // first transit
    // A frame captured right as the transit starts still shows the eye
    // finishing the previous dwell
    const spec = sampleAt(tl, second.startMs + 5)!
    expect(spec.group).toBe(tl.segments[0]!.id)
  })

  it('labels vor samples at the center with the vor group', () => {
    const tl = buildPursuitTimeline(ASPECT)
    const vor = tl.segments.find((s) => s.id === 'vor-lr')!
    const spec = sampleAt(tl, vor.startMs + PURSUIT_LAG_MS + 700)!
    expect(spec.record).toBe(true)
    expect(spec.kind).toBe('vor')
    expect(spec.x).toBe(0.5)
    expect(spec.y).toBe(0.5)
  })

  it('discards the pursuit-acquisition window at transit onset', () => {
    const tl = buildPursuitTimeline(ASPECT)
    const transit = tl.segments.find((s) => s.kind === 'transit')!
    const early = sampleAt(tl, transit.startMs + PURSUIT_LAG_MS + TRANSIT_DISCARD_MS - 20)!
    expect(early.record).toBe(false)
    const later = sampleAt(tl, transit.startMs + PURSUIT_LAG_MS + TRANSIT_DISCARD_MS + 50)!
    expect(later.record).toBe(true)
  })
})

describe('segmentAt', () => {
  it('resolves boundaries to the segment that starts there', () => {
    const tl = buildPursuitTimeline(ASPECT)
    for (let i = 1; i < tl.segments.length; i++) {
      const seg = tl.segments[i]!
      expect(segmentAt(tl, seg.startMs)!.id).toBe(seg.id)
    }
    expect(segmentAt(tl, tl.totalMs)!.id).toBe(tl.segments[tl.segments.length - 1]!.id)
    expect(segmentAt(tl, -1)).toBeNull()
    expect(segmentAt(tl, tl.totalMs + 1)).toBeNull()
  })
})
