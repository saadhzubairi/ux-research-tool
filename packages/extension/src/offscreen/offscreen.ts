import { WS_CONFIG } from '@gazekit/shared'
import type { ExtensionMessage, GazeSample, ServerMessage } from '@gazekit/shared'
import type { ServiceWorkerToOffscreenMessage } from '../types/extension'

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
// Gaze Engine — runs WebGazer inside a sandbox iframe
// ---------------------------------------------------------------------------

let gazeIframe: HTMLIFrameElement | null = null
let gazeVideo: HTMLVideoElement | null = null
let gazeCanvas: HTMLCanvasElement | null = null
let gazeCtx: CanvasRenderingContext2D | null = null
let gazeStream: MediaStream | null = null
let gazeFrameLoop: ReturnType<typeof setTimeout> | null = null
let gazeBuffer: GazeSample[] = []
let gazeFlushTimer: ReturnType<typeof setInterval> | null = null
let gazeFlushCount = 0
let nullPredictionCount = 0
let totalPredictionCount = 0

async function loadAndImportModel(): Promise<void> {
  try {
    // Offscreen documents don't have chrome.storage access — ask the service worker
    const response = await chrome.runtime.sendMessage({ type: 'get_calibration_model' }) as { model: Record<string, unknown> | null }
    const modelData = response?.model
    if (!modelData || !(modelData.screenXClicks as unknown[])?.length) {
      console.warn('[GazeKit Offscreen] ❌ No calibration model — predictions will be null. Recalibrate!')
      return
    }
    console.log('[GazeKit Offscreen] ✓ Got model from service worker:', (modelData.screenXClicks as unknown[]).length, 'training points')
    if (gazeIframe?.contentWindow) {
      gazeIframe.contentWindow.postMessage(
        { source: 'gazekit-parent', type: 'import_model', data: modelData },
        '*',
      )
    } else {
      console.error('[GazeKit Offscreen] ❌ Cannot import model — sandbox iframe not available')
    }
  } catch (err) {
    console.error('[GazeKit Offscreen] ❌ Failed to load calibration model:', err)
  }
}

function handleSandboxMessage(event: MessageEvent): void {
  const msg = event.data
  if (msg?.source !== 'gazekit-sandbox') return

  switch (msg.type) {
    case 'loaded': {
      console.log('[GazeKit Offscreen] Sandbox loaded, starting frame loop...')
      startFrameLoop()
      // Give the frame buffer 200ms to fill, then tell sandbox to init WebGazer
      setTimeout(() => {
        if (!gazeCanvas || !gazeIframe?.contentWindow) {
          console.error('[GazeKit Offscreen] ❌ Cannot send init — canvas or iframe missing')
          return
        }
        const w = gazeCanvas.width
        const h = gazeCanvas.height
        console.log(`[GazeKit Offscreen] Sending init to sandbox: ${w}x${h}`)
        // FIX: Send width/height at top level (sandbox reads msg.width, not msg.data.width)
        gazeIframe.contentWindow.postMessage(
          { source: 'gazekit-parent', type: 'init', width: w, height: h },
          '*',
        )
      }, 200)
      break
    }
    case 'ready': {
      console.log('[GazeKit Offscreen] ✓ Gaze engine ready, importing calibration model...')
      void loadAndImportModel().then(() => {
        startGazeFlush()
        console.log('[GazeKit Offscreen] ✓ Pipeline active: sandbox → offscreen → service worker')
      })
      break
    }
    case 'model_imported': {
      if (msg.data?.success) {
        console.log('[GazeKit Offscreen] ✓ Calibration model imported successfully')
      } else {
        console.warn('[GazeKit Offscreen] ❌ Calibration model import failed:', msg.data?.error)
      }
      break
    }
    case 'gaze': {
      totalPredictionCount++
      const pred = msg.data?.prediction
      if (pred) {
        gazeBuffer.push({ x: pred.x, y: pred.y, ts: Date.now(), conf: null })
        nullPredictionCount = 0 // reset
      } else {
        nullPredictionCount++
      }
      // Log periodically
      if (totalPredictionCount === 1 || totalPredictionCount === 10 || totalPredictionCount % 200 === 0) {
        console.log(
          `[GazeKit Offscreen] Prediction #${totalPredictionCount}: ${pred ? `(${pred.x.toFixed(0)}, ${pred.y.toFixed(0)})` : 'NULL'}`
          + ` | buffer=${gazeBuffer.length} | face=${msg.data?.faceDetected}`
          + ` | nullStreak=${nullPredictionCount}`,
        )
      }
      // Warn if all predictions are null (no calibration model)
      if (nullPredictionCount === 50) {
        console.warn('[GazeKit Offscreen] ⚠️ 50 consecutive null predictions — calibration model may not be loaded. Recalibrate!')
      }
      break
    }
    case 'error': {
      console.error('[GazeKit Offscreen] ❌ Sandbox error:', msg.data)
      break
    }
    case 'log': {
      console.log('[GazeKit Sandbox]', msg.data)
      break
    }
  }
}

function startFrameLoop(): void {
  const sendFrame = () => {
    if (!gazeVideo || !gazeCtx || !gazeCanvas || !gazeIframe?.contentWindow) {
      gazeFrameLoop = setTimeout(sendFrame, 32)
      return
    }
    gazeCtx.drawImage(gazeVideo, 0, 0)
    createImageBitmap(gazeCanvas).then((bitmap) => {
      gazeIframe?.contentWindow?.postMessage(
        { source: 'gazekit-parent', type: 'frame', bitmap },
        '*',
        [bitmap],
      )
    }).catch(() => { /* non-fatal */ })
    gazeFrameLoop = setTimeout(sendFrame, 32) // ~30fps
  }
  gazeFrameLoop = setTimeout(sendFrame, 32)
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
  console.log('[GazeKit Offscreen] Starting gaze engine...')

  // Reset counters
  gazeFlushCount = 0
  nullPredictionCount = 0
  totalPredictionCount = 0

  // 1. Get camera
  gazeStream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' },
  })
  console.log('[GazeKit Offscreen] ✓ Camera acquired')

  // 2. Hidden video element to read frames
  gazeVideo = document.createElement('video')
  gazeVideo.srcObject = gazeStream
  gazeVideo.muted = true
  gazeVideo.playsInline = true
  gazeVideo.style.display = 'none'
  document.body.appendChild(gazeVideo)
  await gazeVideo.play()

  const vw = gazeVideo.videoWidth || 640
  const vh = gazeVideo.videoHeight || 480
  console.log(`[GazeKit Offscreen] ✓ Video playing: ${vw}x${vh}`)

  // 3. Canvas for frame capture → ImageBitmap transfer
  gazeCanvas = document.createElement('canvas')
  gazeCanvas.width = vw
  gazeCanvas.height = vh
  gazeCtx = gazeCanvas.getContext('2d')!

  // 4. Sandbox iframe — WebGazer runs here (has unsafe-eval CSP)
  gazeIframe = document.createElement('iframe')
  gazeIframe.src = chrome.runtime.getURL('src/calibration/sandbox.html')
  gazeIframe.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;pointer-events:none;'
  document.body.appendChild(gazeIframe)
  console.log('[GazeKit Offscreen] ✓ Sandbox iframe created:', gazeIframe.src)

  // 5. Listen for sandbox postMessages
  window.addEventListener('message', handleSandboxMessage)

  console.log('[GazeKit Offscreen] ✓ Gaze engine setup complete, waiting for sandbox to load...')
}

function stopGazeEngine(): void {
  if (gazeFlushTimer) {
    clearInterval(gazeFlushTimer)
    gazeFlushTimer = null
  }
  if (gazeFrameLoop !== null) {
    clearTimeout(gazeFrameLoop)
    gazeFrameLoop = null
  }
  window.removeEventListener('message', handleSandboxMessage)
  if (gazeIframe?.contentWindow) {
    gazeIframe.contentWindow.postMessage(
      { source: 'gazekit-parent', type: 'stop' },
      '*',
    )
  }
  if (gazeIframe) {
    gazeIframe.remove()
    gazeIframe = null
  }
  if (gazeStream) {
    gazeStream.getTracks().forEach((t) => t.stop())
    gazeStream = null
  }
  if (gazeVideo) {
    gazeVideo.remove()
    gazeVideo = null
  }
  gazeCanvas = null
  gazeCtx = null
  gazeBuffer = []
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
