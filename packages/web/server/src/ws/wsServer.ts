import { WebSocketServer, WebSocket } from 'ws'
import type { ExtensionMessage, ServerMessage } from '@gazekit/shared'
import { Session } from '../models/Session'
import { GazeEvent } from '../models/GazeEvent'
import { RrwebEvent } from '../models/RrwebEvent'
import { Screenshot } from '../models/Screenshot'
import { config } from '../config/env'
import fs from 'fs/promises'
import path from 'path'

const connections = new Map<string, WebSocket>()

export function getActiveConnectionCount(): number {
  return connections.size
}

export function createWsServer(port: number): WebSocketServer {
  const wss = new WebSocketServer({ port })

  wss.on('connection', (ws) => {
    let sessionId: string | null = null

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString()) as ExtensionMessage

        switch (message.type) {
          case 'session_start':
            sessionId = message.payload.sessionId
            connections.set(sessionId, ws)
            await handleSessionStart(message.payload)
            sendAck(ws, 'session_start')
            break

          case 'gaze_batch':
            console.log(`[GazeKit WS] Received gaze_batch: ${message.payload.events.length} events, session=${message.payload.sessionId}, batch=#${message.payload.batchIndex}`)
            await handleGazeBatch(message.payload)
            sendAck(ws, 'gaze_batch', message.payload.events.length)
            break

          case 'rrweb_events':
            await handleRrwebEvents(message.payload)
            sendAck(ws, 'rrweb_events')
            break

          case 'page_screenshot':
            await handlePageScreenshot(message.payload)
            sendAck(ws, 'page_screenshot')
            break

          case 'calibration_update':
            await handleCalibrationUpdate(message.payload)
            sendAck(ws, 'calibration_update')
            break

          case 'session_end':
            await handleSessionEnd(message.payload)
            connections.delete(message.payload.sessionId)
            sendAck(ws, 'session_end')
            break

          case 'heartbeat':
            await handleHeartbeat(message.payload)
            sendAck(ws, 'heartbeat')
            break
        }
      } catch (err) {
        console.error('WebSocket message error:', err)
        sendError(ws, 'PARSE_ERROR', 'Invalid message format')
      }
    })

    ws.on('close', () => {
      if (sessionId) {
        connections.delete(sessionId)
      }
    })

    ws.on('error', (err) => {
      console.error('WebSocket error:', err.message)
      if (sessionId) {
        connections.delete(sessionId)
      }
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
    pages: payload.pages?.map(p => ({
      url: p.url,
      enteredAt: new Date(p.enteredAt),
      leftAt: p.leftAt ? new Date(p.leftAt) : undefined,
    })),
    stats: {
      totalGazePoints: 0,
      trackingLossSeconds: 0,
      avgConfidence: 0,
    },
    status: 'active',
  })
}

async function handleGazeBatch(
  payload: Extract<ExtensionMessage, { type: 'gaze_batch' }>['payload']
): Promise<void> {
  const docs = payload.events.map(event => ({
    ts: new Date(event.sample.ts),
    x: event.sample.x,
    y: event.sample.y,
    conf: event.sample.conf,
    el: event.element
      ? {
          sel: event.element.selector,
          tag: event.element.tag,
          txt: event.element.text,
          rect: event.element.rect,
        }
      : undefined,
    ctx: {
      url: event.context.url,
      sx: event.context.scrollX,
      sy: event.context.scrollY,
      vw: event.context.viewportWidth,
      vh: event.context.viewportHeight,
      dw: event.context.docWidth,
      dh: event.context.docHeight,
      dv: event.context.domVersion,
      dpr: event.context.dpr,
    },
    meta: {
      sid: payload.sessionId,
      bi: payload.batchIndex,
    },
  }))

  await GazeEvent.insertMany(docs, { ordered: false })

  const confValues = payload.events
    .map(e => e.sample.conf)
    .filter((c): c is number => c !== null)
  const batchAvgConf = confValues.length > 0
    ? confValues.reduce((sum, c) => sum + c, 0) / confValues.length
    : 0

  await Session.updateOne(
    { sessionId: payload.sessionId },
    {
      $inc: { 'stats.totalGazePoints': payload.events.length },
      $set: { 'stats.avgConfidence': batchAvgConf },
    }
  )
}

async function handleRrwebEvents(
  payload: Extract<ExtensionMessage, { type: 'rrweb_events' }>['payload']
): Promise<void> {
  await RrwebEvent.create({
    sessionId: payload.sessionId,
    events: payload.events,
    receivedAt: new Date(),
  })
}

async function handlePageScreenshot(
  payload: Extract<ExtensionMessage, { type: 'page_screenshot' }>['payload']
): Promise<void> {
  const screenshotDir = path.join(config.dataDir, 'screenshots', payload.sessionId)
  await fs.mkdir(screenshotDir, { recursive: true })

  const timestamp = Date.now()
  const filename = `${timestamp}.png`
  const filePath = path.join(screenshotDir, filename)

  const base64Match = payload.dataUrl.match(/^data:image\/\w+;base64,(.+)$/)
  if (!base64Match?.[1]) {
    throw new Error('Invalid data URL format')
  }

  const buffer = Buffer.from(base64Match[1], 'base64')
  await fs.writeFile(filePath, buffer)

  await Screenshot.create({
    sessionId: payload.sessionId,
    url: payload.url,
    scrollY: payload.scrollY,
    viewportHeight: payload.viewportHeight,
    filePath,
    capturedAt: new Date(timestamp),
  })
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
}

async function handleSessionEnd(
  payload: Extract<ExtensionMessage, { type: 'session_end' }>['payload']
): Promise<void> {
  const session = await Session.findOne({ sessionId: payload.sessionId })
  if (!session) return

  const endedAt = new Date(payload.endedAt)
  const durationMs = endedAt.getTime() - new Date(session.startedAt).getTime()

  // Don't overwrite stats — they were incrementally accumulated by handleGazeBatch.
  // The extension sends hardcoded zeros in session_end; the server-side $inc values
  // from gaze_batch processing are the ground truth.
  await Session.updateOne(
    { sessionId: payload.sessionId },
    {
      $set: {
        endedAt,
        durationMs,
        status: 'completed',
      },
    }
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
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

function sendError(ws: WebSocket, code: string, message: string): void {
  const msg: ServerMessage = {
    type: 'error',
    payload: { code, message },
  }
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}
