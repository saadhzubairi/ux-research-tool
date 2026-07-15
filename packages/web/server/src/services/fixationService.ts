import {
  detectFixations,
  degToPx,
  FIXATION_DISPERSION_THRESHOLD_DEG,
} from '@gazekit/shared'
import type { GazeSample } from '@gazekit/shared'
import { Slice } from '../models/Slice'

/** A stored gaze point on a Slice (Mongo subdoc shape). */
interface StoredGazePoint {
  ts?: Date | null
  x?: number | null
  y?: number | null
  conf?: number | null
  el?: {
    sel?: string | null
    tag?: string | null
    txt?: string | null
    rect?: { x?: number | null; y?: number | null; w?: number | null; h?: number | null } | null
  } | null
}

/** A fixation as persisted on a Slice — SliceFixation plus internal `el`. */
export interface StoredFixation {
  x: number
  y: number
  startTs: Date
  durationMs: number
  el: {
    sel: string
    tag: string
    txt: string
    rect: { x: number; y: number; w: number; h: number }
  } | null
}

/** Dispersion gate in px, derived from a session's pxPerDeg when available. */
export function dispersionThresholdFor(pxPerDeg: number | null | undefined): number | undefined {
  return typeof pxPerDeg === 'number' && Number.isFinite(pxPerDeg) && pxPerDeg > 0
    ? degToPx(FIXATION_DISPERSION_THRESHOLD_DEG, pxPerDeg)
    : undefined
}

/**
 * Compute fixations for a single slice at ingest time.
 *
 * Runs I-DT over this slice's own gaze points plus a small trailing window
 * from the previous 1-2 slices of the same page — I-DT needs temporal
 * continuity across the slice boundary, since a fixation can span a slice
 * edge. Only fixations whose start falls within THIS slice's own time range
 * are kept, so a fixation is attributed to exactly one slice (the one it
 * starts in) and never double-counted.
 *
 * This replaces the old request-time I-DT + LRU cache: the read path is now a
 * pure aggregation over precomputed `Slice.fixations`.
 */
export async function computeSliceFixations(params: {
  pageId: unknown
  sliceIndex: number
  gazePoints: StoredGazePoint[]
  pxPerDeg: number | null | undefined
}): Promise<StoredFixation[]> {
  const { pageId, sliceIndex, gazePoints } = params

  // Trailing window: previous up-to-2 slices on this page, for cross-edge
  // continuity. They're already persisted by the time this slice ingests.
  const trailing =
    sliceIndex > 0
      ? await Slice.find({
          pageId,
          sliceIndex: { $gte: Math.max(0, sliceIndex - 2), $lt: sliceIndex },
        })
          .sort({ sliceIndex: 1 })
          .select({ gazePoints: 1 })
          .lean()
      : []

  const trailingPoints: StoredGazePoint[] = trailing.flatMap(
    (s) => (s.gazePoints as StoredGazePoint[] | undefined) ?? []
  )

  const combined = [...trailingPoints, ...gazePoints]
  const samples: GazeSample[] = combined.map((p) => ({
    x: p.x ?? 0,
    y: p.y ?? 0,
    ts: p.ts ? new Date(p.ts).getTime() : 0,
    conf: p.conf ?? null,
  }))

  // Earliest ts of this slice's OWN points — the boundary for attribution.
  const ownStart = gazePoints.reduce((min, p) => {
    const t = p.ts ? new Date(p.ts).getTime() : 0
    return t > 0 && t < min ? t : min
  }, Number.POSITIVE_INFINITY)

  const dispersionThreshold = dispersionThresholdFor(params.pxPerDeg)
  const fixations = detectFixations(
    samples,
    dispersionThreshold !== undefined ? { dispersionThreshold } : undefined
  )

  return fixations
    .filter((f) => f.startTs >= ownStart)
    .map((f) => {
      // Associate the fixation with the element under its time span, matched
      // from this slice's own points (used only by the /elements ranking).
      const match = gazePoints.find((p) => {
        const t = p.ts ? new Date(p.ts).getTime() : 0
        return t >= f.startTs && t <= f.endTs
      })
      return {
        x: f.x,
        y: f.y,
        startTs: new Date(f.startTs),
        durationMs: f.durationMs,
        el: match?.el?.sel
          ? {
              sel: match.el.sel,
              tag: match.el.tag ?? '',
              txt: match.el.txt ?? '',
              rect: {
                x: match.el.rect?.x ?? 0,
                y: match.el.rect?.y ?? 0,
                w: match.el.rect?.w ?? 0,
                h: match.el.rect?.h ?? 0,
              },
            }
          : null,
      } satisfies StoredFixation
    })
}
