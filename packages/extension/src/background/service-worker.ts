import type { ExtensionMessage } from '@gazekit/shared'
import { normalizeGazeUrl } from '@gazekit/shared'
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

let initialSetupInProgress = false

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
    ],
    justification: 'WebSocket connection and webcam gaze tracking',
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
): Promise<unknown> {
  await ensureOffscreenDocument()
  return chrome.runtime.sendMessage(message)
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
// Tab-capture stream
//
// Replaces captureVisibleTab polling (hard-capped by Chrome at ~2 calls/s).
// A single chrome.tabCapture MediaStream is handed to the offscreen document,
// which samples frames from it per slice tick at any rate.
//
// getMediaStreamId MUST run in direct response to a genuine user gesture (the
// "Start Tracking" popup click). We therefore acquire the streamId at the very
// top of the session-start handler — before ANY of the async gaze-engine start
// chain — while the gesture is still fresh, and thread it down. It cannot be
// silently (re)acquired on an MV3 service-worker wake; the cross-origin
// navigation path (which can tear the stream down) re-requests it best-effort
// and fails LOUDLY, since no gesture is available there.
// ---------------------------------------------------------------------------

async function getTabStreamId(tabId: number): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError || !streamId) {
        reject(new Error(chrome.runtime.lastError?.message ?? 'no streamId'))
        return
      }
      resolve(streamId)
    })
  })
}

/** Hand an already-acquired streamId to the offscreen document to open on. */
async function handStreamToOffscreen(streamId: string): Promise<void> {
  try {
    await sendToOffscreen({ type: 'start_tab_stream', streamId })
    console.log('[GazeKit SW] Tab-capture stream handed to offscreen')
  } catch (err) {
    console.warn('[GazeKit SW] Failed to hand tab-capture stream to offscreen:', err)
  }
}

async function stopTabCapture(): Promise<void> {
  try {
    await sendToOffscreen({ type: 'stop_tab_stream' })
  } catch {
    // Offscreen doc may already be gone
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

  // 2. Acquire the tab-capture streamId NOW, while the "Start Tracking" user
  // gesture is still fresh — before any of the heavy async start chain. Chrome
  // only grants getMediaStreamId in direct response to the gesture, so this
  // ordering (not deferring it into the background chain) is the whole point.
  // Best-effort: if it fails the session still runs, just with empty frames.
  let tabStreamId: string | null = null
  try {
    tabStreamId = await getTabStreamId(tabId)
  } catch (err) {
    console.error(
      '[GazeKit SW] ❌ Failed to acquire tab-capture stream on the start gesture — screenshots will be empty this session:',
      err,
    )
  }

  // 3. Get tab info and update state immediately so popup sees isTracking: true
  const tab = await chrome.tabs.get(tabId)
  state.currentSessionId = sessionId
  state.isTracking = true
  state.isPaused = false
  state.activeTabId = tabId
  state.activeTabUrl = tab.url ?? null
  await saveState()

  // 4. Kick off the heavy async work in the background (don't block the response)
  void startSessionBackground(sessionId, tabId, tabStreamId)

  return sessionId
}

async function startSessionBackground(
  sessionId: string,
  tabId: number,
  tabStreamId: string | null,
): Promise<void> {
  initialSetupInProgress = true
  try {
    // Focus the target tab
    await chrome.tabs.update(tabId, { active: true })
    const targetTab = await chrome.tabs.get(tabId)

    // 1. Offscreen + WebSocket (needed before gaze data can flow)
    console.log('[GazeKit SW] Creating offscreen document...')
    await ensureOffscreenDocument()
    console.log('[GazeKit SW] Connecting WebSocket...')
    await sendToOffscreen({ type: 'connect', port: settings.wsPort })

    // Hand the gesture-fresh tab-capture streamId to the offscreen doc as soon
    // as it exists — streamIds are short-lived, so consume it early rather than
    // after the gaze-engine start chain.
    if (tabStreamId) {
      await handStreamToOffscreen(tabStreamId)
    }

    // 2. Start tracking in content script BEFORE gaze engine
    //    (ensures isTracking=true when samples arrive)
    const trackingMsg: ServiceWorkerToContentMessage = {
      type: 'start_tracking',
      sessionId,
      settings,
      heatmapEnabled: false,
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

    // Push the tab's zoom factor so the content script can convert
    // screen-px gaze samples into its own CSS px
    try {
      const zoomFactor = await chrome.tabs.getZoom(tabId)
      await sendToContentScript(tabId, { type: 'zoom_update', zoomFactor })
    } catch (err) {
      console.warn('[GazeKit SW] Failed to push zoom factor:', err)
    }

    // 3. Start gaze engine AFTER content script is tracking. A failed start
    // (no camera, no valid model) must abort the session — otherwise it runs
    // "active" while recording nothing.
    console.log('[GazeKit SW] Starting gaze engine...')
    const gazeResponse = (await sendToOffscreen({ type: 'start_gaze' })) as
      | { started?: boolean; cameraMismatch?: boolean; error?: string }
      | undefined
    if (!gazeResponse?.started) {
      throw new Error(`Gaze engine failed to start: ${gazeResponse?.error ?? 'no response'}`)
    }
    if (gazeResponse.cameraMismatch) {
      console.warn(
        '[GazeKit SW] ⚠ Session camera/resolution differs from calibration — accuracy degraded, recalibration recommended',
      )
    }
    console.log('[GazeKit SW] Gaze engine started')
    // (Tab-capture stream was already handed to offscreen above, on the fresh
    // start gesture — not here, where the gesture would be long gone.)

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
              screenDiagonalMm: cal.screenDiagonalMm ?? null,
              viewingDistanceMm: cal.viewingDistanceMm ?? null,
              pxPerDeg: cal.pxPerDeg ?? null,
              avgErrorDeg: cal.avgErrorDeg ?? null,
            }
          : {
              method: '6-point-polynomial',
              avgErrorPx: 0,
              precisionPx: 0,
              qualityScore: 0,
              screenWidth: 0,
              screenHeight: 0,
              dpr: 1,
              calibratedAt: new Date().toISOString(),
            },
        tracking: {
          library: 'mediapipe',
          version: '',
          regressionModel: 'polynomial',
          avgFps: 0,
        },
        pages: [
          {
            url: normalizeGazeUrl(targetTab.url ?? ''),
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
    initialSetupInProgress = false
  } catch (err) {
    initialSetupInProgress = false
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

  // 4. Stop the tab-capture stream
  await stopTabCapture()

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
  // MV3 can revive this worker for any event — state must be hydrated from
  // storage before any handler reads it
  await stateReady
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
    case 'slice': {
      // The content script produced a slice (gaze + envelope). The offscreen
      // document owns the tab-capture canvas + WS client, so it grabs the
      // current frame, fills screenshotDataUrl, and sends the assembled slice.
      await sendToOffscreen({ type: 'send_slice', payload: message.payload })
      return { forwarded: true }
    }

    case 'tracking_status': {
      if (message.status === 'error') {
        console.error('[GazeKit] Tracking error:', message.error)
      }
      return { received: true }
    }

    case 'gaze_click_anchor': {
      // Clicks are drift-correction ground truth for the offscreen gaze engine
      try {
        await sendToOffscreen({
          type: 'click_anchor',
          screenX: message.screenX,
          screenY: message.screenY,
          ts: message.ts,
        })
      } catch {
        // Non-fatal — drift correction just skips this click
      }
      return { forwarded: true }
    }

    // -------------------------------------------------------------------
    // Offscreen messages
    // -------------------------------------------------------------------
    case 'ws_status_change': {
      state.wsStatus = message.status
      await saveState()
      return { received: true }
    }

    case 'get_calibration_model': {
      const stored = await chrome.storage.local.get('gazekit:model')
      return { model: stored['gazekit:model'] ?? null }
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
// Zoom listener — keep the tracked tab's screen-px -> CSS-px conversion valid
// ---------------------------------------------------------------------------

chrome.tabs.onZoomChange.addListener((zoomChangeInfo) => {
  void (async () => {
    await stateReady
    if (!state.isTracking || zoomChangeInfo.tabId !== state.activeTabId) return
    try {
      await sendToContentScript(zoomChangeInfo.tabId, {
        type: 'zoom_update',
        zoomFactor: zoomChangeInfo.newZoomFactor,
      })
    } catch {
      // Non-fatal — the content script may not be attached yet
    }
  })()
})

// ---------------------------------------------------------------------------
// Tab navigation listener — re-attach tracking on full-page navigation
// ---------------------------------------------------------------------------

chrome.tabs.onUpdated.addListener(
  (tabId, changeInfo, tab) => {
    void handleTabUpdated(tabId, changeInfo, tab)
  },
)

async function handleTabUpdated(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab,
): Promise<void> {
    await stateReady
    // Only care about the tracked tab completing a navigation
    if (
      !state.isTracking ||
      !state.currentSessionId ||
      tabId !== state.activeTabId ||
      changeInfo.status !== 'complete' ||
      initialSetupInProgress
    ) {
      return
    }

    const newUrl = tab.url ?? ''

    // Skip restricted URLs where content scripts can't run
    if (
      newUrl.startsWith('chrome://') ||
      newUrl.startsWith('chrome-extension://') ||
      newUrl.startsWith('about:') ||
      newUrl.startsWith('devtools://')
    ) {
      return
    }

    // Re-send start_tracking to the fresh content script.
    // This fires on both navigation to a new URL and page refresh (same URL).
    const prevUrl = state.activeTabUrl
    console.log(`[GazeKit SW] Tab loaded: ${prevUrl} → ${newUrl}`)
    state.activeTabUrl = newUrl
    void saveState()

    // Chrome can tear the tab-capture stream down on a cross-origin navigation.
    // Re-request one in that case (best-effort — getMediaStreamId ideally wants
    // a user gesture; a navigation has none, so this may fail and is flagged).
    const reacquireStream = isCrossOrigin(prevUrl, newUrl)
    void reattachTracking(tabId, reacquireStream)
}

function isCrossOrigin(a: string | null, b: string): boolean {
  if (!a) return true
  try {
    return new URL(a).origin !== new URL(b).origin
  } catch {
    return true
  }
}

async function reattachTracking(tabId: number, reacquireStream: boolean): Promise<void> {
  if (!state.currentSessionId) return

  const trackingMsg: ServiceWorkerToContentMessage = {
    type: 'start_tracking',
    sessionId: state.currentSessionId,
    settings,
    heatmapEnabled: false,
  }

  // The manifest-declared content script auto-injects at document_idle,
  // but it may not be ready yet. Retry a few times.
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const response = await sendToContentScript(tabId, trackingMsg) as
        | Record<string, unknown>
        | undefined
      if (response?.success) {
        console.log('[GazeKit SW] ✓ Tracking re-attached on new page')

        // Re-push the zoom factor to the fresh content script
        try {
          const zoomFactor = await chrome.tabs.getZoom(tabId)
          await sendToContentScript(tabId, { type: 'zoom_update', zoomFactor })
        } catch {
          // Non-fatal
        }

        // Re-acquire the tab-capture stream if the navigation likely killed it.
        // No user gesture exists on a navigation, so Chrome may reject this —
        // fail LOUDLY and degrade to empty screenshots until the user
        // re-interacts, rather than swallowing it silently.
        if (reacquireStream) {
          try {
            const streamId = await getTabStreamId(tabId)
            await handStreamToOffscreen(streamId)
          } catch (err) {
            console.error(
              '[GazeKit SW] ❌ Could not re-acquire tab-capture stream after cross-origin navigation (no user gesture available) — screenshots will be EMPTY until tracking is restarted from a fresh click:',
              err,
            )
          }
        }

        // Emit an immediate slice for the new page (trigger 'navigation'):
        // server closes the old Page and opens a new one.
        try {
          await sendToContentScript(tabId, { type: 'navigation_slice' })
        } catch {
          // Non-fatal
        }
        return
      }
    } catch {
      // Content script not ready yet — expected during page load
    }
    await new Promise((r) => setTimeout(r, 300))
  }

  console.warn('[GazeKit SW] ⚠ Failed to re-attach tracking after navigation')
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

// Hydration promise: every event handler awaits this before reading `state`,
// because MV3 revives the worker with default in-memory state
const stateReady = initState()
