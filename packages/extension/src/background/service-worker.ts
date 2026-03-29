import type { ExtensionMessage } from '@gazekit/shared'
import type {
  ExtensionState,
  ExtensionSettings,
  ExtensionStatus,
  InboundMessage,
  ServiceWorkerToContentMessage,
  ServiceWorkerToOffscreenMessage,
} from '../types/extension'
import { DEFAULT_SETTINGS } from '../types/extension'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const STORAGE_KEY_STATE = 'gazekit:state'
const STORAGE_KEY_SETTINGS = 'gazekit:settings'
const OFFSCREEN_PATH = 'src/offscreen/offscreen.html'

let state: ExtensionState = {
  currentSessionId: null,
  isTracking: false,
  isPaused: false,
  wsStatus: 'disconnected',
  activeTabId: null,
  activeTabUrl: null,
  lastCalibration: null,
}

let settings: ExtensionSettings = { ...DEFAULT_SETTINGS }

let screenshotTimer: ReturnType<typeof setInterval> | null = null

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

async function initState(): Promise<void> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEY_STATE,
    STORAGE_KEY_SETTINGS,
    'calibration',
  ])

  const savedState = stored[STORAGE_KEY_STATE] as Partial<ExtensionState> | undefined
  if (savedState) {
    state = { ...state, ...savedState }
  }

  // Fallback: ResultsStep writes calibration directly under the 'calibration' key
  if (!state.lastCalibration && stored['calibration']) {
    state.lastCalibration = stored['calibration']
  }

  const savedSettings = stored[STORAGE_KEY_SETTINGS] as Partial<ExtensionSettings> | undefined
  if (savedSettings) {
    settings = { ...settings, ...savedSettings }
  }
}

async function saveState(): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEY_STATE]: state,
    [STORAGE_KEY_SETTINGS]: settings,
  })
}

// ---------------------------------------------------------------------------
// Offscreen document management
// ---------------------------------------------------------------------------

async function ensureOffscreenDocument(): Promise<void> {
  const exists = await chrome.offscreen.hasDocument()
  if (exists) return

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [
      chrome.offscreen.Reason.WORKERS,
      chrome.offscreen.Reason.USER_MEDIA,
      chrome.offscreen.Reason.IFRAME_SCRIPTING,
    ],
    justification: 'WebSocket connection, webcam gaze tracking, and sandboxed WebGazer',
  })

  // The offscreen module script loads asynchronously after createDocument
  // resolves. Poll until its onMessage listener is registered.
  for (let i = 0; i < 50; i++) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'ping' }) as
        | { ready?: boolean }
        | undefined
      if (resp?.ready) return
    } catch {
      // Listener not registered yet — expected during module load
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  console.warn('[GazeKit SW] Offscreen document did not become ready within 5 s')
}

async function sendToOffscreen(
  message: ServiceWorkerToOffscreenMessage,
): Promise<void> {
  await ensureOffscreenDocument()
  await chrome.runtime.sendMessage(message)
}

// ---------------------------------------------------------------------------
// Content script injection
// ---------------------------------------------------------------------------

async function injectContentScript(tabId: number): Promise<void> {
  const manifest = chrome.runtime.getManifest()
  const file = manifest.content_scripts?.[0]?.js?.[0]
  if (!file) throw new Error('Content script not found in manifest')

  await chrome.scripting.executeScript({
    target: { tabId },
    files: [file],
  })
}

async function sendToContentScript(
  tabId: number,
  message: ServiceWorkerToContentMessage,
): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, message)
}

// ---------------------------------------------------------------------------
// Screenshot capture
// ---------------------------------------------------------------------------

async function captureScreenshot(): Promise<void> {
  if (!state.isTracking || !state.currentSessionId) return

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' })

    const tab = state.activeTabId
      ? await chrome.tabs.get(state.activeTabId)
      : null

    const message: ExtensionMessage = {
      type: 'page_screenshot',
      payload: {
        sessionId: state.currentSessionId,
        url: tab?.url ?? '',
        dataUrl,
        scrollY: 0,
        viewportHeight: 0,
      },
    }

    await sendToOffscreen({ type: 'send', message })
  } catch {
    // Tab may not be capturable (e.g. chrome:// pages)
  }
}

function startScreenshotInterval(): void {
  stopScreenshotInterval()
  screenshotTimer = setInterval(
    () => void captureScreenshot(),
    settings.screenshotIntervalMs,
  )
}

function stopScreenshotInterval(): void {
  if (screenshotTimer !== null) {
    clearInterval(screenshotTimer)
    screenshotTimer = null
  }
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

async function startSession(targetTabId?: number): Promise<string> {
  const sessionId = crypto.randomUUID()

  // 1. Resolve target tab (fast — just a query)
  let tabId: number

  if (targetTabId) {
    tabId = targetTabId
  } else {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const fallback = tabs[0]
    if (!fallback?.id) throw new Error('No active tab found')
    tabId = fallback.id
  }

  // 2. Get tab info and update state immediately so popup sees isTracking: true
  const tab = await chrome.tabs.get(tabId)
  state.currentSessionId = sessionId
  state.isTracking = true
  state.isPaused = false
  state.activeTabId = tabId
  state.activeTabUrl = tab.url ?? null
  await saveState()

  // 3. Kick off the heavy async work in the background (don't block the response)
  void startSessionBackground(sessionId, tabId)

  return sessionId
}

async function startSessionBackground(sessionId: string, tabId: number): Promise<void> {
  try {
    // Focus the target tab
    await chrome.tabs.update(tabId, { active: true })
    const targetTab = await chrome.tabs.get(tabId)

    // 1. Offscreen + WebSocket (needed before gaze data can flow)
    console.log('[GazeKit SW] Creating offscreen document...')
    await ensureOffscreenDocument()
    console.log('[GazeKit SW] Connecting WebSocket...')
    await sendToOffscreen({ type: 'connect', port: settings.wsPort })

    // 2. Start tracking in content script BEFORE gaze engine
    //    (ensures isTracking=true when samples arrive)
    const trackingMsg: ServiceWorkerToContentMessage = {
      type: 'start_tracking',
      sessionId,
      settings,
      heatmapEnabled: true,
    }
    let injected = false
    let trackingSent = false
    let tabScreen: { width: number; height: number } | null = null
    let tabViewport: { width: number; height: number } | null = null
    let tabDpr = 1
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        console.log(`[GazeKit SW] Sending start_tracking to tab ${tabId} (attempt ${attempt + 1})`)
        const response = await sendToContentScript(tabId, trackingMsg) as Record<string, unknown> | undefined
        if (response?.success) {
          trackingSent = true
          tabScreen = (response.screen as { width: number; height: number }) ?? null
          tabViewport = (response.viewport as { width: number; height: number }) ?? null
          tabDpr = (response.dpr as number) ?? 1
          console.log('[GazeKit SW] ✓ start_tracking acknowledged by content script')
          break
        }
        console.warn('[GazeKit SW] start_tracking not acknowledged:', JSON.stringify(response))
      } catch {
        if (!injected) {
          console.log('[GazeKit SW] Injecting content script...')
          await injectContentScript(tabId)
          injected = true
        }
      }
      // Wait for CRXJS loader's dynamic import() to finish
      await new Promise((r) => setTimeout(r, 500))
    }

    if (!trackingSent) {
      console.error('[GazeKit SW] ❌ Failed to send start_tracking after 10 attempts!')
    }

    // 3. Start gaze engine AFTER content script is tracking
    console.log('[GazeKit SW] Starting gaze engine...')
    await sendToOffscreen({ type: 'start_gaze' })
    console.log('[GazeKit SW] Gaze engine started')

    // Start screenshot capture interval
    startScreenshotInterval()

    // Send session_start to server via offscreen (use real calibration data)
    const cal = state.lastCalibration
    const sessionStartMessage: ExtensionMessage = {
      type: 'session_start',
      payload: {
        sessionId,
        userId: '',
        startedAt: new Date().toISOString(),
        endedAt: null,
        durationMs: null,
        device: {
          userAgent: navigator.userAgent,
          screenWidth: tabScreen?.width ?? cal?.screenWidth ?? 0,
          screenHeight: tabScreen?.height ?? cal?.screenHeight ?? 0,
          dpr: tabDpr,
        },
        webcam: {
          label: '',
          resolution: {
            w: tabViewport?.width ?? 0,
            h: tabViewport?.height ?? 0,
          },
        },
        calibration: cal
          ? {
              method: cal.method,
              avgErrorPx: cal.avgErrorPx,
              precisionPx: cal.precisionPx,
              qualityScore: cal.qualityScore,
              screenWidth: cal.screenWidth,
              screenHeight: cal.screenHeight,
              dpr: cal.dpr,
              calibratedAt: cal.calibratedAt,
            }
          : {
              method: '9-point',
              avgErrorPx: 0,
              precisionPx: 0,
              qualityScore: 0,
              screenWidth: 0,
              screenHeight: 0,
              dpr: 1,
              calibratedAt: new Date().toISOString(),
            },
        tracking: {
          library: 'webgazer',
          version: '',
          regressionModel: 'ridge',
          avgFps: 0,
        },
        pages: [
          {
            url: targetTab.url ?? '',
            enteredAt: new Date().toISOString(),
            leftAt: null,
          },
        ],
        stats: {
          totalGazePoints: 0,
          trackingLossSeconds: 0,
          avgConfidence: 0,
        },
      },
    }

    await sendToOffscreen({ type: 'send', message: sessionStartMessage })
  } catch (err) {
    console.error('[GazeKit] Background session start failed:', err)
    // Revert state on failure
    state.currentSessionId = null
    state.isTracking = false
    state.isPaused = false
    state.activeTabId = null
    state.activeTabUrl = null
    await saveState()
  }
}

async function stopSession(): Promise<void> {
  if (!state.currentSessionId) return

  // 1. Tell content script to stop
  if (state.activeTabId !== null) {
    try {
      await sendToContentScript(state.activeTabId, { type: 'stop_tracking' })
    } catch {
      // Tab may have been closed
    }
  }

  // 2. Send session_end to server via offscreen
  const endMessage: ExtensionMessage = {
    type: 'session_end',
    payload: {
      sessionId: state.currentSessionId,
      endedAt: new Date().toISOString(),
      stats: {
        totalGazePoints: 0,
        trackingLossSeconds: 0,
        avgConfidence: 0,
      },
    },
  }

  try {
    await sendToOffscreen({ type: 'send', message: endMessage })
  } catch {
    // Offscreen doc may already be gone
  }

  // 3. Stop gaze engine in offscreen
  try {
    await sendToOffscreen({ type: 'stop_gaze' })
  } catch {
    // Offscreen doc may already be gone
  }

  // 4. Stop screenshot interval
  stopScreenshotInterval()

  // 5. Update state
  state.currentSessionId = null
  state.isTracking = false
  state.isPaused = false
  state.activeTabId = null
  state.activeTabUrl = null
  await saveState()
}

// ---------------------------------------------------------------------------
// Status builder
// ---------------------------------------------------------------------------

function buildStatus(): ExtensionStatus {
  return {
    isTracking: state.isTracking,
    isPaused: state.isPaused,
    currentSessionId: state.currentSessionId,
    wsStatus: state.wsStatus,
    activeTabId: state.activeTabId,
    activeTabUrl: state.activeTabUrl,
    lastCalibration: state.lastCalibration,
    settings,
  }
}

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    message: InboundMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ): boolean => {
    handleMessage(message)
      .then(sendResponse)
      .catch((err: unknown) => {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        sendResponse({ error: errorMessage })
      })

    // Return true to indicate async response
    return true
  },
)

async function handleMessage(message: InboundMessage): Promise<unknown> {
  switch (message.type) {
    // -------------------------------------------------------------------
    // Popup messages
    // -------------------------------------------------------------------
    case 'start_session': {
      const sessionId = await startSession(message.targetTabId)
      return { sessionId }
    }

    case 'stop_session': {
      await stopSession()
      return { stopped: true }
    }

    case 'pause_tracking': {
      if (state.activeTabId !== null && state.isTracking) {
        state.isPaused = true
        await saveState()
        await sendToContentScript(state.activeTabId, { type: 'pause_tracking' })
      }
      return { paused: true }
    }

    case 'resume_tracking': {
      if (state.activeTabId !== null && state.isTracking) {
        state.isPaused = false
        await saveState()
        await sendToContentScript(state.activeTabId, { type: 'resume_tracking' })
      }
      return { resumed: true }
    }

    case 'get_status': {
      return buildStatus()
    }

    case 'open_calibration': {
      const calibrationUrl = chrome.runtime.getURL('src/calibration/calibration.html')
      await chrome.tabs.create({ url: calibrationUrl })
      return { opened: true }
    }

    case 'update_settings': {
      settings = { ...settings, ...message.settings }
      await saveState()
      return { settings }
    }

    case 'calibration_complete': {
      state.lastCalibration = message.calibration
      await saveState()
      return { received: true }
    }

    // -------------------------------------------------------------------
    // Content script messages
    // -------------------------------------------------------------------
    case 'gaze_batch': {
      console.log(`[GazeKit SW] Forwarding gaze_batch: ${message.payload.events.length} events, batch=#${message.payload.batchIndex}`)
      const gazeBatchMessage: ExtensionMessage = {
        type: 'gaze_batch',
        payload: message.payload,
      }
      await sendToOffscreen({ type: 'send', message: gazeBatchMessage })
      return { forwarded: true }
    }

    case 'rrweb_events': {
      const rrwebMessage: ExtensionMessage = {
        type: 'rrweb_events',
        payload: message.payload,
      }
      await sendToOffscreen({ type: 'send', message: rrwebMessage })
      return { forwarded: true }
    }

    case 'tracking_status': {
      if (message.status === 'error') {
        console.error('[GazeKit] Tracking error:', message.error)
      }
      return { received: true }
    }

    case 'page_change': {
      if (message.heatmapDataUrl && state.currentSessionId) {
        const heatmapMessage: ExtensionMessage = {
          type: 'page_screenshot',
          payload: {
            sessionId: state.currentSessionId,
            url: message.url,
            dataUrl: message.heatmapDataUrl,
            scrollY: 0,
            viewportHeight: 0,
          },
        }
        try {
          await sendToOffscreen({ type: 'send', message: heatmapMessage })
        } catch {
          // Non-fatal — best-effort delivery
        }
      }
      return { received: true }
    }

    // -------------------------------------------------------------------
    // Offscreen messages
    // -------------------------------------------------------------------
    case 'ws_status_change': {
      state.wsStatus = message.status
      await saveState()
      return { received: true }
    }

    case 'gaze_samples': {
      // Forward gaze samples from offscreen → content script for heatmap + batching
      if (state.activeTabId !== null && state.isTracking) {
        try {
          await sendToContentScript(state.activeTabId, {
            type: 'gaze_samples',
            samples: message.samples,
          })
        } catch (err) {
          console.warn('[GazeKit SW] Failed to forward gaze_samples to tab', state.activeTabId, err)
        }
      } else {
        console.warn('[GazeKit SW] gaze_samples dropped: activeTabId=', state.activeTabId, 'isTracking=', state.isTracking)
      }
      return { forwarded: true }
    }

    case 'get_calibration_model': {
      const stored = await chrome.storage.local.get('gazekit:model')
      return { model: stored['gazekit:model'] ?? null }
    }

    case 'server_command': {
      return handleServerCommand(message.action)
    }

    default: {
      return { error: 'Unknown message type' }
    }
  }
}

async function handleServerCommand(
  action: 'recalibrate' | 'pause' | 'resume' | 'stop',
): Promise<unknown> {
  switch (action) {
    case 'pause': {
      if (state.activeTabId !== null && state.isTracking) {
        state.isPaused = true
        await saveState()
        await sendToContentScript(state.activeTabId, { type: 'pause_tracking' })
      }
      return { paused: true }
    }

    case 'resume': {
      if (state.activeTabId !== null && state.isTracking) {
        state.isPaused = false
        await saveState()
        await sendToContentScript(state.activeTabId, { type: 'resume_tracking' })
      }
      return { resumed: true }
    }

    case 'stop': {
      await stopSession()
      return { stopped: true }
    }

    case 'recalibrate': {
      // Calibration UI is built in a later phase
      return { recalibrating: true }
    }

    default: {
      return { error: 'Unknown server command' }
    }
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

void initState()
