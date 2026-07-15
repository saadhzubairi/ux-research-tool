import { viewportToNormalized } from '@gazekit/shared'
import type { HeatmapPoint, HeatmapData } from '@gazekit/shared'
import { Page } from '../models/Page'
import { Slice } from '../models/Slice'
import { Session } from '../models/Session'
import { filePathToUrl } from './screenshotStore'
import {
  getLegacySessionHeatmap,
  getLegacyAggregateForSession,
} from './legacyHeatmap'

/**
 * Session heatmap, keyed by Page (a session can revisit the same URL as two
 * distinct pages, which the old url-keyed query conflated). Reads precomputed
 * `Slice.fixations` — a pure aggregation, no request-time I-DT — optionally
 * cut off at a slice index for progressive/scrub playback.
 */
export async function getSessionHeatmap(
  sessionId: string,
  pageId: string,
  toSliceIndex?: number,
): Promise<HeatmapData> {
  const page = await Page.findById(pageId).lean()
  if (!page || page.sessionId !== sessionId) {
    return emptyHeatmap(sessionId, page?.url ?? '')
  }

  const viewportWidth = page.viewport?.width ?? 1920
  const viewportHeight = page.viewport?.height ?? 1080

  const sliceFilter: Record<string, unknown> = { sessionId, pageId: page._id }
  if (toSliceIndex !== undefined) {
    sliceFilter.sliceIndex = { $lte: toSliceIndex }
  }

  const slices = await Slice.find(sliceFilter)
    .sort({ sliceIndex: 1 })
    .select({ sliceIndex: 1, fixations: 1, screenshot: 1 })
    .lean()

  const points: HeatmapPoint[] = []
  for (const slice of slices) {
    for (const f of slice.fixations ?? []) {
      const { nx, ny } = viewportToNormalized(
        f.x ?? 0,
        f.y ?? 0,
        viewportWidth,
        viewportHeight,
      )
      points.push({ nx, ny, value: f.durationMs ?? 0 })
    }
  }

  // Screenshot: the slice at the cutoff (or the latest slice for the page).
  const screenshotSlice = slices.length > 0 ? slices[slices.length - 1] : null
  const screenshotUrl = filePathToUrl(screenshotSlice?.screenshot?.filePath)

  return {
    sessionId,
    url: page.url ?? '',
    viewportWidth,
    viewportHeight,
    points,
    screenshotUrl,
    sessionCount: 1,
    totalFixations: points.length,
  }
}

/**
 * Cross-session aggregate heatmap for a URL. Still URL-keyed by design
 * (aggregation is "all sessions that visited this URL"). v2 sessions source
 * from Page+Slice; v1 sessions fall back to the legacy GazeEvent path.
 */
export async function getAggregateHeatmap(
  url: string,
  from?: string,
  to?: string,
): Promise<HeatmapData> {
  const sessionFilter: Record<string, unknown> = {}
  if (from || to) {
    const dateFilter: Record<string, Date> = {}
    if (from) dateFilter.$gte = new Date(from)
    if (to) dateFilter.$lte = new Date(to)
    sessionFilter.startedAt = dateFilter
  }

  // v2 sessions: those with a Page on this URL. v1 sessions: those with the
  // legacy embedded pages.url. Union both sets within the date window.
  const [v2Pages, v1Sessions] = await Promise.all([
    Page.find({ url }).select({ sessionId: 1 }).lean(),
    Session.find({ ...sessionFilter, 'pages.url': url, schemaVersion: { $ne: 2 } })
      .select({ sessionId: 1 })
      .lean(),
  ])

  const v2SessionIds = [...new Set(v2Pages.map((p) => p.sessionId))]
  // Honor the date window for v2 sessions too.
  const v2Sessions =
    v2SessionIds.length > 0
      ? await Session.find({
          ...sessionFilter,
          sessionId: { $in: v2SessionIds },
        })
          .select({ sessionId: 1 })
          .lean()
      : []
  const v2Filtered = new Set(v2Sessions.map((s) => s.sessionId))

  const allPoints: HeatmapPoint[] = []
  let viewportWidth = 1920
  let viewportHeight = 1080
  let screenshotUrl: string | null = null
  let sessionCount = 0

  // v2 sessions — aggregate over Page/Slice.
  for (const page of v2Pages) {
    if (!v2Filtered.has(page.sessionId)) continue
    const data = await getSessionHeatmapForAggregate(page.sessionId, url)
    if (data.points.length > 0 || data.screenshotUrl) {
      allPoints.push(...data.points)
      viewportWidth = data.viewportWidth
      viewportHeight = data.viewportHeight
      if (!screenshotUrl) screenshotUrl = data.screenshotUrl
    }
    sessionCount++
  }

  // v1 sessions — legacy path.
  for (const s of v1Sessions) {
    const data = await getLegacyAggregateForSession(s.sessionId, url)
    allPoints.push(...data.points)
    if (data.points.length > 0) {
      viewportWidth = data.viewportWidth
      viewportHeight = data.viewportHeight
    }
    if (!screenshotUrl) screenshotUrl = data.screenshotUrl
    sessionCount++
  }

  return {
    sessionId: null,
    url,
    viewportWidth,
    viewportHeight,
    points: allPoints,
    screenshotUrl,
    sessionCount,
    totalFixations: allPoints.length,
  }
}

/** Aggregate all Page-visits of a URL within one v2 session into one point set. */
async function getSessionHeatmapForAggregate(
  sessionId: string,
  url: string,
): Promise<HeatmapData> {
  const pages = await Page.find({ sessionId, url }).lean()
  const points: HeatmapPoint[] = []
  let viewportWidth = 1920
  let viewportHeight = 1080
  let screenshotUrl: string | null = null

  for (const page of pages) {
    viewportWidth = page.viewport?.width ?? viewportWidth
    viewportHeight = page.viewport?.height ?? viewportHeight
    const slices = await Slice.find({ sessionId, pageId: page._id })
      .sort({ sliceIndex: 1 })
      .select({ fixations: 1, screenshot: 1 })
      .lean()
    for (const slice of slices) {
      for (const f of slice.fixations ?? []) {
        const { nx, ny } = viewportToNormalized(
          f.x ?? 0,
          f.y ?? 0,
          viewportWidth,
          viewportHeight,
        )
        points.push({ nx, ny, value: f.durationMs ?? 0 })
      }
      if (!screenshotUrl && slice.screenshot?.filePath) {
        screenshotUrl = filePathToUrl(slice.screenshot.filePath)
      }
    }
  }

  return {
    sessionId,
    url,
    viewportWidth,
    viewportHeight,
    points,
    screenshotUrl,
    sessionCount: 1,
    totalFixations: points.length,
  }
}

function emptyHeatmap(sessionId: string | null, url: string): HeatmapData {
  return {
    sessionId,
    url,
    viewportWidth: 1920,
    viewportHeight: 1080,
    points: [],
    screenshotUrl: null,
    sessionCount: sessionId ? 1 : 0,
    totalFixations: 0,
  }
}

// Re-export the legacy v1 session heatmap so the route can dispatch on
// schemaVersion without importing two modules.
export { getLegacySessionHeatmap }
