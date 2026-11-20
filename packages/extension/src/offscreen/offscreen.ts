import { WS_CONFIG } from '@gazekit/shared'
import type { ExtensionMessage, GazeSample, ServerMessage } from '@gazekit/shared'
import type { ServiceWorkerToOffscreenMessage } from '../types/extension'
import { initFaceLandmarker, detectGazeFrame, closeFaceLandmarker } from './faceLandmarker'
import { BlinkDetector } from './features'
import { predictScreenPx, isValidGazeModel, type GazeModel } from './regression'
import { startTabStream, stopTabStream, grabFrame } from './tabStream'

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

// One Euro tuning for fixation-stable gaze: lower minCutoff than a pointer
// (favor fixation stability), moderate beta. Saccades are handled by the
// explicit filter reset in the saccade gate, not by the filter itself.
const EURO_MIN_CUTOFF = 0.8
const EURO_BETA = 0.02
const EURO_D_CUTOFF = 1.0

function makeEuroFilters(): { x: OneEuroFilter; y: OneEuroFilter } {
  return {
    x: new OneEuroFilter(30, EURO_MIN_CUTOFF, EURO_BETA, EURO_D_CUTOFF),
    y: new OneEuroFilter(30, EURO_MIN_CUTOFF, EURO_BETA, EURO_D_CUTOFF),
  }
}

// ---------------------------------------------------------------------------
// Saccade-aware jump gate.
//
// A single-frame jump far from the current fixation is landmark noise and is
// held back; but if the NEXT frame lands near the jump target, that's a real
// saccade — accept it and reset the smoothing filters so they snap instead
// of lagging across the screen. This replaces the old fixed 1200px kill gate,
// which deadlocked permanently after any legitimate large saccade (rejected
// samples never updated the reference point).
// ---------------------------------------------------------------------------

const SACCADE_JUMP_PX = 250
const SACCADE_CONFIRM_RADIUS_PX = 200

class SaccadeGate {
  private lastAccepted: { x: number; y: number } | null = null
  private pending: { x: number; y: number } | null = null

  /** Returns whether to accept the sample and whether filters must reset. */
  process(x: number, y: number): { accept: boolean; isSaccade: boolean } {
    if (this.lastAccepted === null) {
      this.lastAccepted = { x, y }
      return { accept: true, isSaccade: false }
    }

    const jump = Math.hypot(x - this.lastAccepted.x, y - this.lastAccepted.y)
    if (jump <= SACCADE_JUMP_PX) {
      this.lastAccepted = { x, y }
      this.pending = null
      return { accept: true, isSaccade: false }
    }

    if (
      this.pending !== null &&
      Math.hypot(x - this.pending.x, y - this.pending.y) <= SACCADE_CONFIRM_RADIUS_PX
    ) {
      // Two consecutive far samples agree: real saccade
      this.lastAccepted = { x, y }
      this.pending = null
      return { accept: true, isSaccade: true }
    }

    this.pending = { x, y }
    return { accept: false, isSaccade: false }
  }

  reset(): void {
    this.lastAccepted = null
    this.pending = null
  }
}

// ---------------------------------------------------------------------------
// Click-anchored drift correction.
//
// Users look at what they click, so each click is a free ground-truth pair.
// A conservative, bounded screen-space bias absorbs the slow drift that
// otherwise accumulates between calibration and the end of a session (the
// dominant error source in webcam eye-tracking studies).
// ---------------------------------------------------------------------------

const DRIFT_GAIN = 0.3
const DRIFT_MAX_PX = 200
const DRIFT_MATCH_WINDOW_MS = 300
const DRIFT_MAX_DELTA_PX = 350
const RECENT_GAZE_CAPACITY = 64

class DriftCorrector {
  private biasX = 0
  private biasY = 0
  private recent: Array<{ x: number; y: number; ts: number }> = []

  apply(x: number, y: number): { x: number; y: number } {
    return { x: x + this.biasX, y: y + this.biasY }
  }

  /** Record an emitted (post-filter, post-bias) gaze position. */
  record(x: number, y: number, ts: number): void {
    this.recent.push({ x, y, ts })
    if (this.recent.length > RECENT_GAZE_CAPACITY) this.recent.shift()
  }

  /** Feed a click at global screen px; gaze leads the click slightly. */
  onClick(screenX: number, screenY: number, ts: number): void {
    const windowSamples = this.recent.filter(
      (s) => s.ts >= ts - DRIFT_MATCH_WINDOW_MS && s.ts <= ts,
    )
    if (windowSamples.length < 3) return

    const xs = windowSamples.map((s) => s.x).sort((a, b) => a - b)
    const ys = windowSamples.map((s) => s.y).sort((a, b) => a - b)
    const gazeX = xs[Math.floor(xs.length / 2)] as number
    const gazeY = ys[Math.floor(ys.length / 2)] as number

    const dx = screenX - gazeX
    const dy = screenY - gazeY
    if (Math.hypot(dx, dy) > DRIFT_MAX_DELTA_PX) return // user probably wasn't looking there

    const clamp = (v: number) => Math.max(-DRIFT_MAX_PX, Math.min(DRIFT_MAX_PX, v))
    this.biasX = clamp(this.biasX + DRIFT_GAIN * dx)
    this.biasY = clamp(this.biasY + DRIFT_GAIN * dy)
  }

  reset(): void {
    this.biasX = 0
    this.biasY = 0
    this.recent = []
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
// Gaze Engine — MediaPipe FaceLandmarker in the offscreen document.
// Emits samples in GLOBAL SCREEN px; the content script converts them to its
// own viewport coordinates using live window geometry.
// ---------------------------------------------------------------------------

const GAZE_FLUSH_INTERVAL_MS = 50
const GAZE_FRAME_INTERVAL_MS = 33 // ~30 Hz — matches a typical webcam frame rate
const CLAMP_MARGIN_FRACTION = 0.1

let gazeVideo: HTMLVideoElement | null = null
let gazeStream: MediaStream | null = null
let gazeFrameLoop: ReturnType<typeof setTimeout> | null = null
let gazeBuffer: GazeSample[] = []
let gazeFlushTimer: ReturnType<typeof setInterval> | null = null
let gazeFlushCount = 0
let nullPredictionCount = 0
let engineRunning = false

let euroFilters = makeEuroFilters()
const blinkDetector = new BlinkDetector()
const saccadeGate = new SaccadeGate()
const driftCorrector = new DriftCorrector()

let gazeModel: GazeModel | null = null

async function loadGazeModel(): Promise<void> {
  // Offscreen documents don't have chrome.storage access — ask the service worker
  const response = (await chrome.runtime.sendMessage({ type: 'get_calibration_model' })) as
    | { model?: unknown }
    | undefined
  const data = response?.model
  if (isValidGazeModel(data)) {
    gazeModel = data
    console.log(
      `[GazeKit Offscreen] Gaze model v3 loaded (lambda=${data.lambda}, trainRMSE=${Math.round(data.trainRmsePx)}px)`,
    )
  } else {
    gazeModel = null
    console.warn(
      '[GazeKit Offscreen] No valid v3 calibration model found — recalibration required. No gaze predictions will be produced.',
    )
  }
}

/**
 * Confidence in [0,1]: penalizes head rotation away from the calibration
 * pose and distance changes (inter-ocular scale). Downstream consumers gate
 * on GAZE_CONFIDENCE_THRESHOLD and researchers can weight by it.
 */
function computeConfidence(
  headPose: { yaw: number; pitch: number },
  interocular: number,
  model: GazeModel,
): number {
  let conf = 1.0
  const dYaw = headPose.yaw - model.refHeadPose.yaw
  const dPitch = headPose.pitch - model.refHeadPose.pitch
  const rotDev = Math.hypot(dYaw, dPitch)
  // ~0.5 rad (~29 deg) of head rotation drives confidence to the floor
  conf *= Math.max(0.2, Math.min(1, 1 - rotDev / 0.5))

  if (model.refInterocular > 1e-6) {
    const scaleDev = Math.abs(interocular / model.refInterocular - 1)
    // ~30% closer/farther to the camera drives confidence toward the floor
    conf *= Math.max(0.2, Math.min(1, 1 - scaleDev * 2))
  }
  return Math.round(conf * 100) / 100
}

function processVideoFrame(): void {
  if (!gazeVideo || !engineRunning) return

  const raw = detectGazeFrame(gazeVideo, performance.now())

  if (!raw.faceDetected || !raw.frame || !gazeModel) {
    nullPredictionCount++
    if (nullPredictionCount === 50 || nullPredictionCount === 200) {
      console.warn(
        `[GazeKit Offscreen] ${nullPredictionCount} consecutive null predictions:`,
        `face=${raw.faceDetected}, frame=${!!raw.frame}, model=${!!gazeModel}`,
      )
    }
    return
  }
  nullPredictionCount = 0

  const now = Date.now()

  // Gaze is unreliable while the lid occludes the iris — hold during blinks
  if (blinkDetector.update(raw.frame.ear, now)) return

  const pred = predictScreenPx(gazeModel, raw.frame.features)
  if (!Number.isFinite(pred.x) || !Number.isFinite(pred.y)) return

  // Clamp to the calibrated region with a margin — the regression
  // extrapolates without bound outside the calibrated hull. The box is
  // anchored to where calibration actually happened: on a multi-monitor
  // desktop the calibrated monitor's global origin is NOT (0,0).
  const b = gazeModel.calibBounds
  const mw = Math.max(b.right - b.left, 1) * CLAMP_MARGIN_FRACTION
  const mh = Math.max(b.bottom - b.top, 1) * CLAMP_MARGIN_FRACTION
  const clampedX = Math.max(b.left - mw, Math.min(b.right + mw, pred.x))
  const clampedY = Math.max(b.top - mh, Math.min(b.bottom + mh, pred.y))

  const gate = saccadeGate.process(clampedX, clampedY)
  if (!gate.accept) return
  if (gate.isSaccade) {
    // Snap to the new fixation instead of dragging the filter across the screen
    euroFilters = makeEuroFilters()
  }

  const filteredX = euroFilters.x.filter(clampedX, now)
  const filteredY = euroFilters.y.filter(clampedY, now)

  const corrected = driftCorrector.apply(filteredX, filteredY)
  driftCorrector.record(corrected.x, corrected.y, now)

  const conf = computeConfidence(raw.frame.headPose, raw.frame.interocular, gazeModel)

  gazeBuffer.push({ x: corrected.x, y: corrected.y, ts: now, conf })
}

function startDetectionLoop(): void {
  engineRunning = true
  const video = gazeVideo
  if (!video) return

  // A thrown frame (GPU context loss, camera unplugged mid-inference) must
  // never kill the loop — always schedule the next frame BEFORE processing
  const safeProcess = (): void => {
    try {
      if (gazeVideo && gazeVideo.readyState >= 2) processVideoFrame()
    } catch (err) {
      console.error('[GazeKit Offscreen] Frame processing failed:', err)
    }
  }

  // Do NOT use requestVideoFrameCallback here. This engine runs inside an
  // OFFSCREEN DOCUMENT, which Chrome never renders or composites — and rVFC
  // callbacks only fire when the <video> is actually painted. In the offscreen
  // doc rVFC never fires, so the entire gaze pipeline silently stalls (zero
  // samples ever reach the server). A setTimeout loop runs regardless of
  // visibility; MediaPipe reads the latest decoded frame from the live camera
  // stream each tick (the camera keeps decoding frames while hidden).
  const detect = (): void => {
    if (!engineRunning) return
    gazeFrameLoop = setTimeout(detect, GAZE_FRAME_INTERVAL_MS)
    safeProcess()
  }
  detect()
}

function startGazeFlush(): void {
  if (gazeFlushTimer) return
  console.log(`[GazeKit Offscreen] ✓ Gaze flush timer started (${GAZE_FLUSH_INTERVAL_MS}ms interval)`)
  gazeFlushTimer = setInterval(() => {
    if (gazeBuffer.length === 0) return
    const samples = [...gazeBuffer]
    gazeBuffer = []
    gazeFlushCount++
    if (gazeFlushCount <= 5 || gazeFlushCount % 100 === 0) {
      console.log(`[GazeKit Offscreen] Flush #${gazeFlushCount}: sending ${samples.length} samples to service worker`)
    }
    chrome.runtime.sendMessage({ type: 'gaze_samples', samples }).catch((err: unknown) => {
      console.error('[GazeKit Offscreen] ❌ Failed to send gaze_samples to service worker:', err)
    })
  }, GAZE_FLUSH_INTERVAL_MS)
}

async function startGazeEngine(): Promise<{ cameraMismatch: boolean }> {
  // Idempotent: a second start_session must not leak the previous stream or
  // leave a zombie rvfc loop running
  if (engineRunning || gazeStream) stopGazeEngine()

  try {
    await loadGazeModel()

    // A session without a valid model records nothing — fail loudly so the
    // service worker aborts the session instead of running it empty. This
    // also catches stale pre-v3 calibrations after the pipeline upgrade.
    if (!gazeModel) {
      throw new Error('No valid calibration model — please (re)calibrate before tracking')
    }

    // Pin the camera AND capture resolution used at calibration — features
    // are frame-normalized, so a different camera pose or aspect ratio
    // silently invalidates the model
    const videoConstraints: MediaTrackConstraints = {
      width: { ideal: gazeModel?.cameraSize?.width ?? 1280 },
      height: { ideal: gazeModel?.cameraSize?.height ?? 720 },
      frameRate: { ideal: 30 },
      facingMode: 'user',
    }
    if (gazeModel?.cameraDeviceId) {
      videoConstraints.deviceId = { ideal: gazeModel.cameraDeviceId }
    }
    gazeStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints })

    const settings = gazeStream.getVideoTracks()[0]?.getSettings()
    let cameraMismatch = false
    if (
      gazeModel?.cameraDeviceId &&
      settings?.deviceId &&
      settings.deviceId !== gazeModel.cameraDeviceId
    ) {
      cameraMismatch = true
      console.warn(
        '[GazeKit Offscreen] ⚠ Session camera differs from calibration camera — accuracy will degrade. Recalibrate with this camera.',
      )
    }
    if (gazeModel?.cameraSize && settings?.width && settings?.height) {
      const calibAspect = gazeModel.cameraSize.width / gazeModel.cameraSize.height
      const sessionAspect = settings.width / settings.height
      if (Math.abs(calibAspect / sessionAspect - 1) > 0.02) {
        cameraMismatch = true
        console.warn(
          `[GazeKit Offscreen] ⚠ Capture aspect ratio changed since calibration (${gazeModel.cameraSize.width}x${gazeModel.cameraSize.height} -> ${settings.width}x${settings.height}) — the feature space has shifted. Recalibrate.`,
        )
      }
    }

    gazeVideo = document.createElement('video')
    gazeVideo.srcObject = gazeStream
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

    startDetectionLoop()
    startGazeFlush()

    console.log(
      `[GazeKit Offscreen] Gaze engine started (MediaPipe, ${settings?.width ?? '?'}x${settings?.height ?? '?'}@${settings?.frameRate ?? '?'}fps)`,
    )
    return { cameraMismatch }
  } catch (err) {
    console.error('[GazeKit Offscreen] Failed to start gaze engine:', err)
    stopGazeEngine() // release any partially-acquired camera/video resources
    throw err
  }
}

function stopGazeEngine(): void {
  engineRunning = false

  if (gazeFrameLoop) clearTimeout(gazeFrameLoop)
  gazeFrameLoop = null

  if (gazeFlushTimer) clearInterval(gazeFlushTimer)
  gazeFlushTimer = null

  closeFaceLandmarker()
  gazeModel = null

  if (gazeVideo) {
    gazeVideo.remove()
    gazeVideo = null
  }
  if (gazeStream) {
    gazeStream.getTracks().forEach((t) => t.stop())
    gazeStream = null
  }

  gazeBuffer = []
  euroFilters = makeEuroFilters()
  blinkDetector.reset()
  saccadeGate.reset()
  driftCorrector.reset()
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
        client.send(message.message)
        sendResponse({ sent: true })
        return true
      }

      case 'start_gaze': {
        startGazeEngine()
          .then((result) => sendResponse({ started: true, cameraMismatch: result.cameraMismatch }))
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

      case 'click_anchor': {
        driftCorrector.onClick(message.screenX, message.screenY, message.ts)
        sendResponse({ ok: true })
        return true
      }

      case 'start_tab_stream': {
        startTabStream(message.streamId)
          .then(() => sendResponse({ started: true }))
          .catch((err: unknown) => {
            console.error('[GazeKit Offscreen] ❌ Failed to start tab stream:', err)
            sendResponse({ error: err instanceof Error ? err.message : 'Unknown error' })
          })
        return true
      }

      case 'stop_tab_stream': {
        stopTabStream()
        sendResponse({ stopped: true })
        return true
      }

      case 'send_slice': {
        // Grab the current tab-capture frame and send the assembled slice over
        // the WS on one clock. An empty screenshot (stream not yet ready) is
        // sent rather than dropping the gaze points.
        const screenshotDataUrl = grabFrame() ?? ''
        const sliceMessage: ExtensionMessage = {
          type: 'slice',
          payload: { ...message.payload, screenshotDataUrl },
        }
        client.send(sliceMessage)
        sendResponse({ sent: true })
        return true
      }

      default: {
        return undefined
      }
    }
  },
)
