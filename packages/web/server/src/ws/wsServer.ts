import { WebSocketServer, WebSocket } from 'ws'
import type {
  ExtensionMessage,
  DashboardMessage,
  ServerMessage,
  DashboardPushMessage,
  SlicePayload,
  SliceListItem,
  SliceFixation,
  GazePoint,
} from '@gazekit/shared'
import { normalizeGazeUrl } from '@gazekit/shared'
import { Session } from '../models/Session'
import { Page } from '../models/Page'
import { Slice } from '../models/Slice'
import { computeSliceFixations } from '../services/fixationService'
import type { StoredFixation } from '../services/fixationService'
import { writeSliceScreenshot, sliceScreenshotUrl } from '../services/screenshotStore'

// Extension ingestion connections, keyed by sessionId (one live session each).
const connections = new Map<string, WebSocket>()
// Dashboard live-heatmap subscribers, keyed by sessionId.
const subscribers = new Map<string, Set<WebSocket>>()
// In-memory active Page per session — avoids a DB lookup on every slice.
// Rebuilt from the DB on a cache miss (e.g. after a server restart mid-session).
const activePages = new Map<string, { pageId: string; url: string; pageIndex: number }>()
// Cached pxPerDeg per session for the ingest-time fixation dispersion gate.
const sessionPxPerDeg = new Map<string, number | null>()

export function getActiveConnectionCount(): number {
  return connections.size
}

export function createWsServer(port: number): WebSocketServer {
  const wss = new WebSocketServer({ port })

  wss.on('connection', (ws) => {
    let sessionId: string | null = null
    // Sessions this socket is a dashboard subscriber for (cleanup on close).
    const subscribedTo = new Set<string>()

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString()) as ExtensionMessage | DashboardMessage

        switch (message.type) {
          case 'session_start':
            sessionId = message.payload.sessionId
            connections.set(sessionId, ws)
            await handleSessionStart(message.payload)
            sendAck(ws, 'session_start')
            break

          case 'slice':
            await handleSlice(message.payload)
            sendAck(ws, 'slice', message.payload.gazePoints.length)
            break

          case 'calibration_update':
            await handleCalibrationUpdate(message.payload)
            sendAck(ws, 'calibration_update')
            break

          case 'session_end':
            await handleSessionEnd(message.payload)
            connections.delete(message.payload.sessionId)
            activePages.delete(message.payload.sessionId)
            sessionPxPerDeg.delete(message.payload.sessionId)
            sendAck(ws, 'session_end')
            break

          case 'heartbeat':
            await handleHeartbeat(message.payload)
            sendAck(ws, 'heartbeat')
            break

          case 'subscribe':
            subscribeDashboard(message.payload.sessionId, ws)
            subscribedTo.add(message.payload.sessionId)
            break

          case 'unsubscribe':
            unsubscribeDashboard(message.payload.sessionId, ws)
            subscribedTo.delete(message.payload.sessionId)
            break
        }
      } catch (err) {
        console.error('WebSocket message error:', err)
        sendError(ws, 'PARSE_ERROR', 'Invalid message format')
      }
    })

    ws.on('close', () => {
      if (sessionId) connections.delete(sessionId)
      for (const sid of subscribedTo) unsubscribeDashboard(sid, ws)
    })

    ws.on('error', (err) => {
      console.error('WebSocket error:', err.message)
      if (sessionId) connections.delete(sessionId)
      for (const sid of subscribedTo) unsubscribeDashboard(sid, ws)
    })
  })

  return wss
}

async function handleSessionStart(
  payload: Extract<ExtensionMessage, { type: 'session_start' }>['payload']
): Promise<void> {
  await Session.create({
    sessionId: payload.sessionId,
    userId: payload.userId || 'anonymous',
    startedAt: new Date(payload.startedAt),
    device: payload.device,
    webcam: payload.webcam,
    calibration: payload.calibration
      ? {
          ...payload.calibration,
          calibratedAt: payload.calibration.calibratedAt
            ? new Date(payload.calibration.calibratedAt)
            : undefined,
        }
      : undefined,
    tracking: payload.tracking,
    // New sessions use the Page/Slice model.
    schemaVersion: 2,
    stats: {
      totalGazePoints: 0,
      trackingLossSeconds: 0,
      avgConfidence: 0,
    },
    status: 'active',
  })

  const pxPerDeg = payload.calibration?.pxPerDeg
  sessionPxPerDeg.set(
    payload.sessionId,
    typeof pxPerDeg === 'number' ? pxPerDeg : null
  )
}

/**
 * Ingest one capture tick. Collapses the old gaze_batch + page_screenshot +
 * visit-detection handlers: page boundaries are now explicit (navigation
 * trigger, or a URL mismatch as an SPA-transition safety net), fixations are
 * computed here, and completed slices fan out to dashboard subscribers.
 */
async function handleSlice(payload: SlicePayload): Promise<void> {
  const { sessionId, trigger, capturedAt, gazePoints } = payload
  const url = normalizeGazeUrl(payload.url)
  const capturedDate = new Date(capturedAt)

  // 1. Resolve the current Page for this session.
  const page = await resolveActivePage(sessionId, url, trigger, capturedDate, {
    width: payload.viewportWidth,
    height: payload.viewportHeight,
    dpr: 1,
  })

  // 2. Reserve this slice's index atomically (single writer per session).
  const bumped = await Page.findByIdAndUpdate(
    page.pageId,
    { $inc: { sliceCount: 1 } },
    { new: true, projection: { sliceCount: 1 } }
  )
  const sliceIndex = (bumped?.sliceCount ?? 1) - 1

  // 3. Persist the screenshot to disk (scheme sessionId/pageId/sliceIndex.png).
  const filePath = await writeSliceScreenshot(
    sessionId,
    page.pageId,
    sliceIndex,
    payload.screenshotDataUrl
  )

  // 4. Map wire gaze points to stored shape.
  const storedGazePoints = gazePoints.map((gp: GazePoint) => ({
    ts: new Date(gp.sample.ts),
    x: gp.sample.x,
    y: gp.sample.y,
    conf: gp.sample.conf,
    el: gp.element
      ? {
          sel: gp.element.selector,
          tag: gp.element.tag,
          txt: gp.element.text,
          rect: gp.element.rect,
        }
      : null,
  }))

  // 5. Compute fixations at ingest (cheap: this slice's points + a trailing
  //    window from the prior 1-2 slices). Written on the initial insert since
  //    time-series collections don't support post-insert measurement updates.
  const pxPerDeg = await resolvePxPerDeg(sessionId)
  const fixations = await computeSliceFixations({
    pageId: page.pageId,
    sliceIndex,
    gazePoints: storedGazePoints,
    pxPerDeg,
  })

  // 6. Insert the slice.
  const created = await Slice.create({
    sessionId,
    pageId: page.pageId,
    sliceIndex,
    capturedAt: capturedDate,
    trigger,
    screenshot: {
      filePath,
      scrollX: payload.scrollX,
      scrollY: payload.scrollY,
      viewportWidth: payload.viewportWidth,
      viewportHeight: payload.viewportHeight,
    },
    gazePoints: storedGazePoints,
    fixations,
  })

  // 7. Accumulate session stats (same weighted-mean scheme as the old path).
  const confValues = gazePoints
    .map((gp) => gp.sample.conf)
    .filter((c): c is number => c !== null)
  const confSum = confValues.reduce((sum, c) => sum + c, 0)
  const session = await Session.findOneAndUpdate(
    { sessionId },
    {
      $inc: {
        'stats.totalGazePoints': gazePoints.length,
        'stats.confSum': confSum,
        'stats.confCount': confValues.length,
      },
    },
    { new: true, projection: { stats: 1 } }
  )
  const stats = session?.stats
  if (stats && stats.confCount > 0) {
    await Session.updateOne(
      { sessionId },
      { $set: { 'stats.avgConfidence': stats.confSum / stats.confCount } }
    )
  }

  // 8. Fan out to dashboard subscribers.
  const listItem: SliceListItem = {
    _id: String(created._id),
    sessionId,
    pageId: page.pageId,
    sliceIndex,
    capturedAt: capturedDate.toISOString(),
    trigger,
    screenshot: {
      url: sliceScreenshotUrl(sessionId, page.pageId, sliceIndex),
      scrollX: payload.scrollX,
      scrollY: payload.scrollY,
      viewportWidth: payload.viewportWidth,
      viewportHeight: payload.viewportHeight,
    },
    fixations: toWireFixations(fixations),
  }
  broadcast(sessionId, {
    type: 'slice_ingested',
    payload: { sessionId, pageId: page.pageId, slice: listItem },
  })
}

/** Client-facing SliceFixation[] — drops the internal `el` enrichment. */
function toWireFixations(fixations: StoredFixation[]): SliceFixation[] {
  return fixations.map((f) => ({
    x: f.x,
    y: f.y,
    startTs: f.startTs.toISOString(),
    durationMs: f.durationMs,
  }))
}

/**
 * Resolve (and, when needed, roll over) the active Page for a session. A new
 * Page opens on an explicit navigation trigger, when there's no active page,
 * or when the URL no longer matches (safety net for missed SPA transitions).
 */
async function resolveActivePage(
  sessionId: string,
  url: string,
  trigger: SlicePayload['trigger'],
  capturedAt: Date,
  viewport: { width: number; height: number; dpr: number }
): Promise<{ pageId: string; url: string; pageIndex: number }> {
  let active = activePages.get(sessionId)

  // Cache miss (e.g. server restart mid-session): rebuild from the DB.
  if (!active) {
    const existing = await Page.findOne({ sessionId, status: 'active' })
      .sort({ pageIndex: -1 })
      .lean()
    if (existing) {
      active = {
        pageId: String(existing._id),
        url: existing.url ?? '',
        pageIndex: existing.pageIndex ?? 0,
      }
      activePages.set(sessionId, active)
    }
  }

  const needsNewPage = trigger === 'navigation' || !active || active.url !== url
  if (!needsNewPage) return active!

  // Close the prior active page.
  if (active) {
    await Page.updateOne(
      { _id: active.pageId },
      { $set: { leftAt: capturedAt, status: 'complete' } }
    )
  }

  const prevCount = await Page.countDocuments({ sessionId })
  const created = await Page.create({
    sessionId,
    pageIndex: prevCount,
    url,
    enteredAt: capturedAt,
    leftAt: null,
    sliceCount: 0,
    viewport,
    status: 'active',
  })

  const next = { pageId: String(created._id), url, pageIndex: prevCount }
  activePages.set(sessionId, next)
  return next
}

async function resolvePxPerDeg(sessionId: string): Promise<number | null> {
  const cached = sessionPxPerDeg.get(sessionId)
  if (cached !== undefined) return cached
  const session = await Session.findOne({ sessionId })
    .select({ 'calibration.pxPerDeg': 1 })
    .lean()
  const pxPerDeg = session?.calibration?.pxPerDeg
  const value = typeof pxPerDeg === 'number' ? pxPerDeg : null
  sessionPxPerDeg.set(sessionId, value)
  return value
}

function subscribeDashboard(sessionId: string, ws: WebSocket): void {
  let set = subscribers.get(sessionId)
  if (!set) {
    set = new Set()
    subscribers.set(sessionId, set)
  }
  set.add(ws)
}

function unsubscribeDashboard(sessionId: string, ws: WebSocket): void {
  const set = subscribers.get(sessionId)
  if (!set) return
  set.delete(ws)
  if (set.size === 0) subscribers.delete(sessionId)
}

function broadcast(sessionId: string, msg: DashboardPushMessage): void {
  const set = subscribers.get(sessionId)
  if (!set || set.size === 0) return
  const data = JSON.stringify(msg)
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data)
  }
}

async function handleCalibrationUpdate(
  payload: Extract<ExtensionMessage, { type: 'calibration_update' }>['payload']
): Promise<void> {
  await Session.updateOne(
    { sessionId: payload.sessionId },
    {
      $set: {
        calibration: {
          ...payload.calibration,
          calibratedAt: payload.calibration.calibratedAt
            ? new Date(payload.calibration.calibratedAt)
            : new Date(),
        },
      },
    }
  )
  const pxPerDeg = payload.calibration.pxPerDeg
  sessionPxPerDeg.set(payload.sessionId, typeof pxPerDeg === 'number' ? pxPerDeg : null)
}

async function handleSessionEnd(
  payload: Extract<ExtensionMessage, { type: 'session_end' }>['payload']
): Promise<void> {
  const session = await Session.findOne({ sessionId: payload.sessionId })
  if (!session) return

  const endedAt = new Date(payload.endedAt)
  const durationMs = endedAt.getTime() - new Date(session.startedAt).getTime()

  // Close the still-active page, if any.
  await Page.updateMany(
    { sessionId: payload.sessionId, status: 'active' },
    { $set: { leftAt: endedAt, status: 'complete' } }
  )

  // Don't overwrite stats — they were incrementally accumulated by handleSlice.
  await Session.updateOne(
    { sessionId: payload.sessionId },
    { $set: { endedAt, durationMs, status: 'completed' } }
  )
}

async function handleHeartbeat(
  payload: Extract<ExtensionMessage, { type: 'heartbeat' }>['payload']
): Promise<void> {
  await Session.updateOne(
    { sessionId: payload.sessionId },
    { $set: { updatedAt: new Date(payload.ts) } }
  )
}

function sendAck(ws: WebSocket, messageType: string, received = 1): void {
  const msg: ServerMessage = {
    type: 'ack',
    payload: { messageType, received },
  }
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function sendError(ws: WebSocket, code: string, message: string): void {
  const msg: ServerMessage = {
    type: 'error',
    payload: { code, message },
  }
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}
