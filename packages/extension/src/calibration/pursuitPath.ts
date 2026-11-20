// ---------------------------------------------------------------------------
// Smooth-pursuit calibration timeline.
//
// Instead of a grid of discrete fixation targets, calibration is ONE
// continuous animation: a dot glides around the screen (dwelling briefly at
// the corners and center so the extremes of the calibrated hull get clean
// stationary samples), then holds at the center while the user slowly turns
// their head (a vestibulo-ocular phase — gaze target constant, head pose
// varying — which is what teaches the regression to compensate head
// movement). Every video frame during the sweep is a labeled training
// sample, so ~20 seconds yields several hundred samples with full-screen
// coverage — far more data than minutes of discrete points, with far less
// user effort.
//
// This module is pure math (no DOM): the SAME position function drives the
// rendered dot and the training labels, so they can never disagree.
// ---------------------------------------------------------------------------

export interface PathPoint {
  /** Normalized viewport coordinates in [0, 1] */
  x: number
  y: number
}

export type SegmentKind = 'dwell' | 'transit' | 'vor'

export interface PathSegment {
  /** Stable id — the regression's cross-validation fold / weighting group */
  id: string
  kind: SegmentKind
  from: PathPoint
  /** Equal to `from` for dwell and vor segments */
  to: PathPoint
  startMs: number
  endMs: number
}

export interface PursuitTimeline {
  segments: PathSegment[]
  totalMs: number
  /** End of the moving-dot portion; the vor (head-turn) phase follows */
  pursuitMs: number
}

// Anchor positions. Corners sit near the true screen edges — the regression
// extrapolates poorly outside the calibrated hull, so the hull must be pinned
// at the extremes (same insets the old discrete grid used).
const C: PathPoint = { x: 0.5, y: 0.5 }
const TL: PathPoint = { x: 0.06, y: 0.08 }
const TR: PathPoint = { x: 0.94, y: 0.08 }
const BL: PathPoint = { x: 0.06, y: 0.92 }
const BR: PathPoint = { x: 0.94, y: 0.92 }

// Dot speed in screen-HEIGHT units per second. A screen height is ~18-20 deg
// of visual angle at typical viewing distance, so 1.05 height-units/s is
// ~20 deg/s — comfortably inside the range the eye tracks with smooth
// pursuit (accuracy degrades past ~30 deg/s).
const PURSUIT_SPEED_HU_PER_S = 1.05
const MIN_TRANSIT_MS = 700

// Constant velocity suits pursuit best, but the eye needs ~200ms to acquire
// a newly moving target — so each transit ramps up over its first EASE_MS
// (and those samples are discarded below anyway).
const TRANSIT_EASE_MS = 200

const DWELL_START_MS = 900
const DWELL_CORNER_MS = 650
const DWELL_CENTER_MS = 600
const DWELL_FINAL_MS = 600
const VOR_PHASE_MS = 3500

// The eye trails a moving target by ~100-150ms (pursuit latency), so a
// frame captured at time t shows the eye looking where the dot was at
// t - PURSUIT_LAG_MS. Labels are read at the lagged time.
export const PURSUIT_LAG_MS = 110

// Discard windows at the start of each segment: saccade/settle at dwell
// onset, pursuit acquisition at transit onset, instruction comprehension at
// vor onset.
export const DWELL_DISCARD_MS = 250
export const TRANSIT_DISCARD_MS = 200
export const VOR_DISCARD_MS = 600

/**
 * Build the calibration timeline for a viewport with the given aspect ratio
 * (width / height). Aspect matters because transit durations derive from
 * physical path length: a horizontal sweep crosses more visual angle on a
 * wide screen than the same normalized distance vertically.
 */
export function buildPursuitTimeline(aspect: number): PursuitTimeline {
  const safeAspect = Number.isFinite(aspect) && aspect > 0.1 ? aspect : 16 / 9

  const transitMs = (from: PathPoint, to: PathPoint): number => {
    const heightUnits = Math.hypot((to.x - from.x) * safeAspect, to.y - from.y)
    return Math.max(MIN_TRANSIT_MS, Math.round((heightUnits / PURSUIT_SPEED_HU_PER_S) * 1000))
  }

  // Border corners + center revisits + two diagonal pairs: every screen
  // quadrant's interior is crossed and all four corners get dwells.
  const waypoints: Array<{ point: PathPoint; dwellMs: number }> = [
    { point: C, dwellMs: DWELL_START_MS },
    { point: TL, dwellMs: DWELL_CORNER_MS },
    { point: TR, dwellMs: DWELL_CORNER_MS },
    { point: C, dwellMs: DWELL_CENTER_MS },
    { point: BL, dwellMs: DWELL_CORNER_MS },
    { point: BR, dwellMs: DWELL_CORNER_MS },
    { point: C, dwellMs: DWELL_FINAL_MS },
  ]

  const segments: PathSegment[] = []
  let cursor = 0
  waypoints.forEach((wp, i) => {
    if (i > 0) {
      const prev = (waypoints[i - 1] as { point: PathPoint }).point
      const dur = transitMs(prev, wp.point)
      segments.push({
        id: `transit-${i}`,
        kind: 'transit',
        from: prev,
        to: wp.point,
        startMs: cursor,
        endMs: cursor + dur,
      })
      cursor += dur
    }
    segments.push({
      id: `dwell-${i}`,
      kind: 'dwell',
      from: wp.point,
      to: wp.point,
      startMs: cursor,
      endMs: cursor + wp.dwellMs,
    })
    cursor += wp.dwellMs
  })

  const pursuitMs = cursor

  for (const axis of ['lr', 'ud'] as const) {
    segments.push({
      id: `vor-${axis}`,
      kind: 'vor',
      from: C,
      to: C,
      startMs: cursor,
      endMs: cursor + VOR_PHASE_MS,
    })
    cursor += VOR_PHASE_MS
  }

  return { segments, totalMs: cursor, pursuitMs }
}

/** Segment containing time t (segments are contiguous; end-exclusive except the last). */
export function segmentAt(timeline: PursuitTimeline, tMs: number): PathSegment | null {
  if (tMs < 0 || tMs > timeline.totalMs) return null
  for (const seg of timeline.segments) {
    if (tMs < seg.endMs || seg === timeline.segments[timeline.segments.length - 1]) {
      if (tMs >= seg.startMs) return seg
    }
  }
  return null
}

/**
 * Distance fraction along a transit for elapsed fraction u in [0,1]:
 * quadratic velocity ramp over the first `r` of the segment, constant
 * velocity after, normalized to land exactly at 1.
 */
function easedProgress(u: number, r: number): number {
  if (r <= 0) return u
  if (u <= r) return (u * u) / (r * (2 - r))
  return (2 * u - r) / (2 - r)
}

/** Dot position at time t. Clamps to the path endpoints outside the timeline. */
export function dotPositionAt(timeline: PursuitTimeline, tMs: number): PathPoint {
  const first = timeline.segments[0] as PathSegment
  const last = timeline.segments[timeline.segments.length - 1] as PathSegment
  if (tMs <= 0) return first.from
  if (tMs >= timeline.totalMs) return last.to

  const seg = segmentAt(timeline, tMs) ?? last
  if (seg.kind !== 'transit') return seg.from

  const duration = seg.endMs - seg.startMs
  const u = Math.min(1, Math.max(0, (tMs - seg.startMs) / duration))
  const r = Math.min(0.5, TRANSIT_EASE_MS / duration)
  const p = easedProgress(u, r)
  return {
    x: seg.from.x + (seg.to.x - seg.from.x) * p,
    y: seg.from.y + (seg.to.y - seg.from.y) * p,
  }
}

export interface SampleSpec {
  /** False inside a discard window (settling / pursuit acquisition) */
  record: boolean
  /** Training label in normalized viewport coords (where the EYE is looking) */
  x: number
  y: number
  group: string
  kind: SegmentKind
}

/**
 * Training-label spec for a video frame captured at time t (ms since the
 * timeline started). Applies pursuit lag: the eye is where the dot was
 * PURSUIT_LAG_MS ago. Returns null before the lagged clock starts or after
 * the timeline ends.
 */
export function sampleAt(timeline: PursuitTimeline, tMs: number): SampleSpec | null {
  const laggedT = tMs - PURSUIT_LAG_MS
  if (laggedT < 0 || laggedT > timeline.totalMs) return null

  const seg = segmentAt(timeline, laggedT)
  if (!seg) return null

  const sinceStart = laggedT - seg.startMs
  const discardMs =
    seg.kind === 'dwell'
      ? DWELL_DISCARD_MS
      : seg.kind === 'transit'
        ? TRANSIT_DISCARD_MS
        : VOR_DISCARD_MS

  const pos = dotPositionAt(timeline, laggedT)
  return {
    record: sinceStart >= discardMs,
    x: pos.x,
    y: pos.y,
    group: seg.id,
    kind: seg.kind,
  }
}
