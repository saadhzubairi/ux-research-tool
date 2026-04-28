import { WS_CONFIG } from '@gazekit/shared'
import type { ExtensionMessage, GazeSample, ServerMessage } from '@gazekit/shared'
import type { ServiceWorkerToOffscreenMessage } from '../types/extension'
import { initFaceLandmarker, detectGaze, closeFaceLandmarker } from './faceLandmarker'
import { predictGaze, type PolynomialModel } from './polynomial'

// ---------------------------------------------------------------------------
// One Euro Filter — adaptive low-pass filter for gaze smoothing
// ---------------------------------------------------------------------------

class LowPassFilter {
  private s: number | null = null

  filter(value: number, alpha: number): number {
    if (this.s === null) {
      this.s = value
    } else {
      this.s = alpha * value + (1 - alpha) * this.s
    }
    return this.s
  }

  get last(): number | null {
    return this.s
  }
}

class OneEuroFilter {
  private freq: number
  private minCutoff: number
  private beta: number
  private dCutoff: number
  private xFilt = new LowPassFilter()
  private dxFilt = new LowPassFilter()
  private lastTime: number | null = null

  constructor(freq: number, minCutoff: number, beta: number, dCutoff: number) {
    this.freq = freq
    this.minCutoff = minCutoff
    this.beta = beta
    this.dCutoff = dCutoff
  }

  private alpha(cutoff: number): number {
    const te = 1.0 / this.freq
    const tau = 1.0 / (2 * Math.PI * cutoff)
    return 1.0 / (1.0 + tau / te)
  }

  filter(value: number, timestamp: number): number {
    if (this.lastTime !== null) {
      const dt = (timestamp - this.lastTime) / 1000
      if (dt > 0) this.freq = 1.0 / dt
    }
    this.lastTime = timestamp

    const prev = this.xFilt.last
    const dValue = prev !== null ? (value - prev) * this.freq : 0
    const edValue = this.dxFilt.filter(dValue, this.alpha(this.dCutoff))
    const cutoff = this.minCutoff + this.beta * Math.abs(edValue)
    return this.xFilt.filter(value, this.alpha(cutoff))
  }
}

// ---------------------------------------------------------------------------
// WebSocket client for offscreen document
// ---------------------------------------------------------------------------

class WebSocketClient {
  private ws: WebSocket | null = null
  private messageQueue: string[] = []
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null
  private port: number
  private sessionId: string | null = null

  private static readonly MAX_QUEUE_SIZE = 1000

  constructor(port: number = WS_CONFIG.PORT) {
    this.port = port
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return

    try {
      this.ws = new WebSocket(`ws://localhost:${this.port}`)

      this.ws.onopen = () => {
        this.flushQueue()
        this.startKeepalive()
        this.reconnectAttempts = 0
        this.notifyStatus('connected')
      }

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string) as ServerMessage
          if (data.type === 'command') {
            void chrome.runtime.sendMessage({
              type: 'server_command',
              action: data.payload.action,
            })
          }
          if (data.type === 'error') {
            console.error('[GazeKit WS] Server error:', data.payload.message)
          }
        } catch {
          console.error('[GazeKit WS] Failed to parse server message')
        }
      }

      this.ws.onclose = () => {
        this.stopKeepalive()
        this.reconnect()
      }

      this.ws.onerror = () => {
        console.error('[GazeKit WS] Connection error')
      }
    } catch {
      console.error('[GazeKit WS] Failed to create WebSocket')
      this.reconnect()
    }
  }

  send(message: ExtensionMessage): void {
    const serialized = JSON.stringify(message)
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(serialized)
    } else {
      this.enqueue(serialized)
    }
  }

  disconnect(): void {
    this.stopKeepalive()
    this.clearReconnectTimer()
    this.reconnectAttempts = WS_CONFIG.MAX_RECONNECT_ATTEMPTS
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
    this.notifyStatus('disconnected')
  }

  private enqueue(serialized: string): void {
    if (this.messageQueue.length >= WebSocketClient.MAX_QUEUE_SIZE) {
      this.messageQueue.shift()
    }
    this.messageQueue.push(serialized)
  }

  private flushQueue(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift()
      if (msg !== undefined) this.ws.send(msg)
    }
  }

  private reconnect(): void {
    if (this.reconnectAttempts >= WS_CONFIG.MAX_RECONNECT_ATTEMPTS) {
      this.notifyStatus('disconnected')
      return
    }
    this.notifyStatus('reconnecting')
    const delay = Math.min(
      WS_CONFIG.RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts),
      30_000,
    )
    this.reconnectAttempts++
    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => this.connect(), delay)
  }

  private startKeepalive(): void {
    this.stopKeepalive()
    this.keepaliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && this.sessionId) {
        const heartbeat: ExtensionMessage = {
          type: 'heartbeat',
          payload: { sessionId: this.sessionId, ts: Date.now() },
        }
        this.ws.send(JSON.stringify(heartbeat))
      }
    }, WS_CONFIG.KEEPALIVE_INTERVAL_MS)
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer !== null) {
      clearInterval(this.keepaliveTimer)
      this.keepaliveTimer = null
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private notifyStatus(status: 'connected' | 'disconnected' | 'reconnecting'): void {
    void chrome.runtime.sendMessage({ type: 'ws_status_change', status })
  }

  setSessionId(sessionId: string | null): void {
    this.sessionId = sessionId
  }

  updatePort(port: number): void {
    this.port = port
  }
}

const client = new WebSocketClient()

// ---------------------------------------------------------------------------
// Gaze Engine — runs MediaPipe FaceLandmarker directly in the offscreen document
// ---------------------------------------------------------------------------

let gazeVideo: HTMLVideoElement | null = null
let gazeStream: MediaStream | null = null
let gazeFrameLoop: ReturnType<typeof setTimeout> | null = null
let gazeBuffer: GazeSample[] = []
let gazeFlushTimer: ReturnType<typeof setInterval> | null = null
let gazeFlushCount = 0
let nullPredictionCount = 0

// One Euro Filter instances for smoothing gaze predictions (re-created per session)
let gazeFilterX = new OneEuroFilter(60, 1.5, 0.007, 1.0)
let gazeFilterY = new OneEuroFilter(60, 1.5, 0.007, 1.0)

// Outlier rejection — track last accepted position
let lastAcceptedX: number | null = null
let lastAcceptedY: number | null = null

let polynomialModel: PolynomialModel | null = null

async function loadPolynomialModel(): Promise<void> {
  const stored = await chrome.storage.local.get('gazekit:model')
  const data = stored['gazekit:model']
  if (data?.coeffsX && data?.coeffsY) {
    polynomialModel = { coeffsX: data.coeffsX, coeffsY: data.coeffsY }
    console.log('[GazeKit Offscreen] Polynomial model loaded')
  } else {
    console.warn('[GazeKit Offscreen] No calibration model found')
  }
}

function startDetectionLoop(): void {
  const detect = () => {
    if (!gazeVideo || gazeVideo.readyState < 2) {
      gazeFrameLoop = setTimeout(detect, 16)
      return
    }

    const raw = detectGaze(gazeVideo, performance.now())

    if (!raw.faceDetected || !raw.normalizedIris || !polynomialModel) {
      nullPredictionCount++
      if (nullPredictionCount === 50) {
        console.warn('[GazeKit Offscreen] 50 consecutive null predictions — check calibration')
      }
      gazeFrameLoop = setTimeout(detect, 16)
      return
    }

    nullPredictionCount = 0
    const pred = predictGaze(polynomialModel, raw.normalizedIris.x, raw.normalizedIris.y)
    const now = Date.now()

    // Outlier rejection (>400px jump)
    if (lastAcceptedX !== null && lastAcceptedY !== null) {
      const dx = pred.x - lastAcceptedX
      const dy = pred.y - lastAcceptedY
      if (Math.sqrt(dx * dx + dy * dy) > 400) {
        gazeFrameLoop = setTimeout(detect, 16)
        return
      }
    }

    // One Euro Filter expects millisecond timestamps (it divides by 1000 internally).
    // Pass Date.now() directly — do NOT divide by 1000 here.
    const filteredX = gazeFilterX.filter(pred.x, now)
    const filteredY = gazeFilterY.filter(pred.y, now)
    lastAcceptedX = filteredX
    lastAcceptedY = filteredY

    gazeBuffer.push({ x: filteredX, y: filteredY, ts: now, conf: null })
    gazeFrameLoop = setTimeout(detect, 16)
  }

  detect()
}

function startGazeFlush(): void {
  if (gazeFlushTimer) return
  console.log('[GazeKit Offscreen] ✓ Gaze flush timer started (100ms interval)')
  gazeFlushTimer = setInterval(() => {
    if (gazeBuffer.length === 0) return
    const samples = [...gazeBuffer]
    gazeBuffer = []
    gazeFlushCount++
    if (gazeFlushCount <= 5 || gazeFlushCount % 50 === 0) {
      console.log(`[GazeKit Offscreen] Flush #${gazeFlushCount}: sending ${samples.length} samples to service worker`)
    }
    // FIX: Don't use void — catch errors so we see if service worker is unreachable
    chrome.runtime.sendMessage({ type: 'gaze_samples', samples }).catch((err: unknown) => {
      console.error('[GazeKit Offscreen] ❌ Failed to send gaze_samples to service worker:', err)
    })
  }, 100)
}

async function startGazeEngine(): Promise<void> {
  try {
    gazeStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
    })

    gazeVideo = document.createElement('video')
    gazeVideo.srcObject = gazeStream
    gazeVideo.width = 640
    gazeVideo.height = 480
    gazeVideo.autoplay = true
    gazeVideo.playsInline = true
    gazeVideo.muted = true
    gazeVideo.style.position = 'fixed'
    gazeVideo.style.opacity = '0'
    gazeVideo.style.pointerEvents = 'none'
    document.body.appendChild(gazeVideo)
    await gazeVideo.play()

    const wasmPath = chrome.runtime.getURL('mediapipe/wasm')
    const modelPath = chrome.runtime.getURL('mediapipe/models/face_landmarker.task')
    await initFaceLandmarker(wasmPath, modelPath)

    await loadPolynomialModel()

    startDetectionLoop()
    startGazeFlush()

    console.log('[GazeKit Offscreen] Gaze engine started (MediaPipe)')
  } catch (err) {
    console.error('[GazeKit Offscreen] Failed to start gaze engine:', err)
  }
}

function stopGazeEngine(): void {
  if (gazeFrameLoop) clearTimeout(gazeFrameLoop)
  gazeFrameLoop = null

  if (gazeFlushTimer) clearInterval(gazeFlushTimer)
  gazeFlushTimer = null

  closeFaceLandmarker()
  polynomialModel = null

  if (gazeVideo) {
    gazeVideo.remove()
    gazeVideo = null
  }
  if (gazeStream) {
    gazeStream.getTracks().forEach((t) => t.stop())
    gazeStream = null
  }

  gazeBuffer = []
  gazeFilterX = new OneEuroFilter(60, 1.5, 0.007, 1.0)
  gazeFilterY = new OneEuroFilter(60, 1.5, 0.007, 1.0)
  lastAcceptedX = null
  lastAcceptedY = null
  nullPredictionCount = 0

  console.log('[GazeKit Offscreen] Gaze engine stopped')
}

// ---------------------------------------------------------------------------
// Listen for messages from the service worker
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    message: ServiceWorkerToOffscreenMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ): boolean | undefined => {
    switch (message.type) {
      case 'ping': {
        sendResponse({ ready: true })
        return true
      }

      case 'connect': {
        client.updatePort(message.port)
        client.connect()
        sendResponse({ connected: true })
        return true
      }

      case 'disconnect': {
        client.disconnect()
        sendResponse({ disconnected: true })
        return true
      }

      case 'send': {
        if (message.message.type === 'session_start') {
          client.setSessionId(message.message.payload.sessionId)
        } else if (message.message.type === 'session_end') {
          client.setSessionId(null)
        }
        if (message.message.type === 'gaze_batch') {
          const batch = message.message.payload as { events: unknown[]; batchIndex: number }
          console.log(`[GazeKit Offscreen] Sending gaze_batch via WS: ${batch.events.length} events, batch=#${batch.batchIndex}`)
        }
        client.send(message.message)
        sendResponse({ sent: true })
        return true
      }

      case 'start_gaze': {
        startGazeEngine()
          .then(() => sendResponse({ started: true }))
          .catch((err: unknown) => {
            console.error('[GazeKit Offscreen] ❌ Failed to start gaze engine:', err)
            sendResponse({ error: err instanceof Error ? err.message : 'Unknown error' })
          })
        return true
      }

      case 'stop_gaze': {
        stopGazeEngine()
        sendResponse({ stopped: true })
        return true
      }

      default: {
        return undefined
      }
    }
  },
)
