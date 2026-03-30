import { viewportToNormalized } from '@gazekit/shared'
import type { HeatmapPoint, HeatmapData } from '@gazekit/shared'
import { GazeEvent } from '../models/GazeEvent'
import { Screenshot } from '../models/Screenshot'
import { Session } from '../models/Session'
import { getFixations } from './fixationService'

function buildScreenshotUrl(screenshot: Record<string, unknown> | null): string | null {
  if (!screenshot) return null
  const filename = screenshot.filename as string | undefined
  const sessionId = screenshot.sessionId as string | undefined
  const visitFolder = screenshot.visitFolder as string | undefined
  const filePath = screenshot.filePath as string | undefined
  if (filename && sessionId && visitFolder) {
    return `/api/screenshots/${sessionId}/${visitFolder}/${filename}`
  }
  if (filename && sessionId) {
    return `/api/screenshots/${sessionId}/${filename}`
  }
  if (filePath) {
    return `/api/screenshots/${filePath.split('/').pop()}`
  }
  return null
}

export async function getSessionHeatmap(
  sessionId: string,
  url: string,
  fromTs?: number,
  toTs?: number,
): Promise<HeatmapData> {
  const fixations = await getFixations(sessionId, url, fromTs, toTs)

  const firstEvent = await GazeEvent.findOne({
    'meta.sid': sessionId,
    'ctx.url': url,
  }).sort({ ts: 1 }).lean()

  const viewportWidth = firstEvent?.ctx?.vw ?? 1920
  const viewportHeight = firstEvent?.ctx?.vh ?? 1080

  const points: HeatmapPoint[] = fixations.map(f => {
    const { nx, ny } = viewportToNormalized(f.x, f.y, viewportWidth, viewportHeight)
    return {
      nx,
      ny,
      value: f.durationMs,
    }
  })

  let screenshotDoc: Record<string, unknown> | null = null
  if (toTs !== undefined) {
    // In timeline mode, pick screenshot closest to the time bound
    const toDate = new Date(toTs)
    const before = await Screenshot.findOne({
      sessionId, url, capturedAt: { $lte: toDate },
    }).sort({ capturedAt: -1 }).lean()
    const after = await Screenshot.findOne({
      sessionId, url, capturedAt: { $gt: toDate },
    }).sort({ capturedAt: 1 }).lean()

    if (before && after) {
      const diffBefore = toDate.getTime() - new Date(before.capturedAt).getTime()
      const diffAfter = new Date(after.capturedAt).getTime() - toDate.getTime()
      const pick = diffBefore <= diffAfter ? before : after
      screenshotDoc = { filePath: pick.filePath, filename: pick.filename, visitFolder: pick.visitFolder, sessionId }
    } else {
      const pick = before ?? after
      screenshotDoc = pick ? { filePath: pick.filePath, filename: pick.filename, visitFolder: pick.visitFolder, sessionId } : null
    }
  } else {
    const latest = await Screenshot.findOne({ sessionId, url })
      .sort({ capturedAt: -1 }).lean()
    screenshotDoc = latest ? { filePath: latest.filePath, filename: latest.filename, visitFolder: latest.visitFolder, sessionId } : null
  }

  const screenshotUrl = buildScreenshotUrl(screenshotDoc)

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

export async function getAggregateHeatmap(
  url: string,
  from?: string,
  to?: string
): Promise<HeatmapData> {
  const sessionFilter: Record<string, unknown> = {
    'pages.url': url,
  }

  if (from || to) {
    const dateFilter: Record<string, Date> = {}
    if (from) dateFilter.$gte = new Date(from)
    if (to) dateFilter.$lte = new Date(to)
    sessionFilter.startedAt = dateFilter
  }

  const sessions = await Session.find(sessionFilter).select('sessionId').lean()
  const sessionIds = sessions.map(s => s.sessionId)

  if (sessionIds.length === 0) {
    return {
      sessionId: null,
      url,
      viewportWidth: 1920,
      viewportHeight: 1080,
      points: [],
      screenshotUrl: null,
      sessionCount: 0,
      totalFixations: 0,
    }
  }

  const allPoints: HeatmapPoint[] = []
  let viewportWidth = 1920
  let viewportHeight = 1080

  for (const sid of sessionIds) {
    const fixations = await getFixations(sid, url)

    const firstEvent = await GazeEvent.findOne({
      'meta.sid': sid,
      'ctx.url': url,
    }).sort({ ts: 1 }).lean()

    if (firstEvent?.ctx) {
      viewportWidth = firstEvent.ctx.vw ?? viewportWidth
      viewportHeight = firstEvent.ctx.vh ?? viewportHeight
    }

    for (const f of fixations) {
      const { nx, ny } = viewportToNormalized(f.x, f.y, viewportWidth, viewportHeight)
      allPoints.push({
        nx,
        ny,
        value: f.durationMs,
      })
    }
  }

  const aggScreenshot = await Screenshot.findOne({ url })
    .sort({ capturedAt: -1 }).lean()

  const screenshotUrl = buildScreenshotUrl(
    aggScreenshot
      ? { filePath: aggScreenshot.filePath, filename: aggScreenshot.filename, visitFolder: aggScreenshot.visitFolder, sessionId: aggScreenshot.sessionId }
      : null
  )

  return {
    sessionId: null,
    url,
    viewportWidth,
    viewportHeight,
    points: allPoints,
    screenshotUrl,
    sessionCount: sessionIds.length,
    totalFixations: allPoints.length,
  }
}
