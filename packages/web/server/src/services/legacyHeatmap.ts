import { viewportToNormalized, detectFixations } from '@gazekit/shared'
import type { HeatmapPoint, HeatmapData, GazeSample, Fixation } from '@gazekit/shared'
import { GazeEvent } from '../models/GazeEvent'
import { Screenshot } from '../models/Screenshot'
import { Session } from '../models/Session'
import { dispersionThresholdFor } from './fixationService'

// Read path for pre-rework (schemaVersion 1) sessions. These still carry the
// old top-level GazeEvent + Screenshot collections, joined by URL and nearest
// timestamp. Kept as a version branch until v1 data ages out (90-day TTL);
// no data is migrated. Fixations here are computed on demand (no cache) since
// v1 traffic is winding down.

function buildLegacyScreenshotUrl(s: {
  filename?: string | null
  visitFolder?: string | null
  filePath?: string | null
  sessionId?: string | null
}): string | null {
  if (s.filename && s.sessionId && s.visitFolder) {
    return `/api/screenshots/${s.sessionId}/${s.visitFolder}/${s.filename}`
  }
  if (s.filename && s.sessionId) {
    return `/api/screenshots/${s.sessionId}/${s.filename}`
  }
  if (s.filePath) {
    return `/api/screenshots/${s.filePath.split('/').pop()}`
  }
  return null
}

async function computeLegacyFixations(
  sessionId: string,
  url: string,
  fromTs?: number,
  toTs?: number,
): Promise<Fixation[]> {
  const query: Record<string, unknown> = { 'meta.sid': sessionId, 'ctx.url': url }
  if (fromTs !== undefined || toTs !== undefined) {
    const tsFilter: Record<string, Date> = {}
    if (fromTs !== undefined) tsFilter.$gte = new Date(fromTs)
    if (toTs !== undefined) tsFilter.$lte = new Date(toTs)
    query.ts = tsFilter
  }

  const gazeEvents = await GazeEvent.find(query).sort({ ts: 1 }).lean()
  const samples: GazeSample[] = gazeEvents.map((e) => ({
    x: e.x ?? 0,
    y: e.y ?? 0,
    ts: e.ts ? new Date(e.ts).getTime() : 0,
    conf: e.conf ?? null,
  }))

  const session = await Session.findOne({ sessionId }).lean()
  const dispersionThreshold = dispersionThresholdFor(session?.calibration?.pxPerDeg)

  return detectFixations(
    samples,
    dispersionThreshold !== undefined ? { dispersionThreshold } : undefined,
  )
}

export async function getLegacySessionHeatmap(
  sessionId: string,
  url: string,
  fromTs?: number,
  toTs?: number,
): Promise<HeatmapData> {
  const fixations = await computeLegacyFixations(sessionId, url, fromTs, toTs)

  const firstEvent = await GazeEvent.findOne({ 'meta.sid': sessionId, 'ctx.url': url })
    .sort({ ts: 1 })
    .lean()
  const viewportWidth = firstEvent?.ctx?.vw ?? 1920
  const viewportHeight = firstEvent?.ctx?.vh ?? 1080

  const points: HeatmapPoint[] = fixations.map((f) => {
    const { nx, ny } = viewportToNormalized(f.x, f.y, viewportWidth, viewportHeight)
    return { nx, ny, value: f.durationMs }
  })

  let pick: Record<string, unknown> | null = null
  if (toTs !== undefined) {
    const toDate = new Date(toTs)
    const before = await Screenshot.findOne({ sessionId, url, capturedAt: { $lte: toDate } })
      .sort({ capturedAt: -1 })
      .lean()
    const after = await Screenshot.findOne({ sessionId, url, capturedAt: { $gt: toDate } })
      .sort({ capturedAt: 1 })
      .lean()
    if (before && after) {
      const diffBefore = toDate.getTime() - new Date(before.capturedAt).getTime()
      const diffAfter = new Date(after.capturedAt).getTime() - toDate.getTime()
      pick = diffBefore <= diffAfter ? before : after
    } else {
      pick = before ?? after
    }
  } else {
    pick = await Screenshot.findOne({ sessionId, url }).sort({ capturedAt: -1 }).lean()
  }

  const screenshotUrl = pick
    ? buildLegacyScreenshotUrl({
        filename: pick.filename as string | undefined,
        visitFolder: pick.visitFolder as string | undefined,
        filePath: pick.filePath as string | undefined,
        sessionId,
      })
    : null

  return {
    sessionId,
    url,
    viewportWidth,
    viewportHeight,
    points,
    screenshotUrl,
    sessionCount: 1,
    totalFixations: fixations.length,
  }
}

/** One v1 session's contribution to a cross-session aggregate heatmap. */
export async function getLegacyAggregateForSession(
  sessionId: string,
  url: string,
): Promise<HeatmapData> {
  return getLegacySessionHeatmap(sessionId, url)
}
