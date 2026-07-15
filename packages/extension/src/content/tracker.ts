// ---------------------------------------------------------------------------
// GazeKit Content Script Entry Point
// ---------------------------------------------------------------------------
// Injected by the service worker via chrome.scripting.executeScript.
// Initializes and coordinates all subsystems:
//   - sliceManager — the slice clock: gaze accumulation + cadence + delivery
//   - spaDetector  — client-side route change detection
//   - domVersionTracker — significant DOM mutation counter
//   - heatmapOverlay — live heatmap canvas
//
// Gaze samples arrive via messages from the offscreen document (where
// MediaPipe Face Mesh runs for gaze prediction).
//
// Idempotent: re-injection does not create duplicate trackers.
// ---------------------------------------------------------------------------

import type { GazeSample, WindowGeometry } from '@gazekit/shared'
import { captureWindowGeometry, viewportOriginOnScreen } from '@gazekit/shared'
import type {
  ServiceWorkerToContentMessage,
  ExtensionSettings,
} from '../types/extension'
import { sliceManager } from './sliceManager'
import { spaDetector } from './spaDetector'
import {
  startDomVersionTracking,
  stopDomVersionTracking,
} from './domVersionTracker'
import { heatmapOverlay } from './heatmapOverlay'

// ---------------------------------------------------------------------------
// Idempotency guard
// ---------------------------------------------------------------------------

const GAZEKIT_KEY = '__GAZEKIT_INITIALIZED'

interface GazeKitWindow {
  [GAZEKIT_KEY]?: boolean
}

if (!(window as unknown as GazeKitWindow)[GAZEKIT_KEY]) {
  ;(window as unknown as GazeKitWindow)[GAZEKIT_KEY] = true

  let sessionId: string | null = null
  let isTracking = false
  let isPaused = false
  let heatmapEnabled = false

  let gazePointCount = 0

  // Page zoom factor, pushed by the service worker (chrome.tabs.getZoom).
  // Needed to convert between global screen px and this page's CSS px.
  let zoomFactor = 1

  // How far outside the viewport a converted sample may land before we treat
  // it as gaze at browser chrome / another window and drop it.
  const VIEWPORT_SLACK_PX = 50

  // True viewport origin measured from a real user click
  // (MouseEvent.screenX/Y are global screen px; clientX/Y are CSS px).
  // More reliable than the chrome-height heuristic when DevTools is docked
  // to the side/bottom. Valid only while the window geometry that produced
  // it is unchanged.
  let measuredOrigin: { x: number; y: number; geomKey: string } | null = null

  const geometryKey = (g: WindowGeometry): string =>
    `${g.screenX},${g.screenY},${g.outerWidth},${g.outerHeight},${g.innerWidth},${g.innerHeight},${g.zoom}`

  const currentViewportOrigin = (geometry: WindowGeometry): { x: number; y: number } => {
    if (measuredOrigin && measuredOrigin.geomKey === geometryKey(geometry)) {
      return { x: measuredOrigin.x, y: measuredOrigin.y }
    }
    return viewportOriginOnScreen(geometry)
  }

  // Samples arrive from the offscreen gaze engine in GLOBAL SCREEN px.
  // Convert them to this tab's viewport coordinates using live window
  // geometry — this is what makes a session survive the window being moved
  // or resized after calibration.
  const gazeCallback = (screenSample: GazeSample): void => {
    const geometry = captureWindowGeometry(window, zoomFactor)
    const origin = currentViewportOrigin(geometry)
    const client = {
      x: (screenSample.x - origin.x) / geometry.zoom,
      y: (screenSample.y - origin.y) / geometry.zoom,
    }

    if (
      client.x < -VIEWPORT_SLACK_PX ||
      client.y < -VIEWPORT_SLACK_PX ||
      client.x > window.innerWidth + VIEWPORT_SLACK_PX ||
      client.y > window.innerHeight + VIEWPORT_SLACK_PX
    ) {
      return // looking at browser chrome or outside this window
    }

    const sample: GazeSample = { ...screenSample, x: client.x, y: client.y }

    gazePointCount++
    sliceManager.addSample(sample)
    if (heatmapEnabled) {
      heatmapOverlay.addPoint(sample.x, sample.y)
    }
    // Debug logging — first 10 points, then every 100th
    if (gazePointCount <= 10 || gazePointCount % 100 === 0) {
      console.log(`[GazeKit] 👁 Heatmap point #${gazePointCount}: [${Math.round(sample.x)}, ${Math.round(sample.y)}] heatmap=${heatmapEnabled}`)
    }
  }

  // Users look where they click — forward clicks (in screen px) so the
  // offscreen engine can correct slow drift against them. Each click also
  // reveals the TRUE viewport origin, which supersedes the geometry heuristic.
  const clickAnchorListener = (event: MouseEvent): void => {
    if (!isTracking || isPaused) return
    const geometry = captureWindowGeometry(window, zoomFactor)

    measuredOrigin = {
      x: event.screenX - event.clientX * geometry.zoom,
      y: event.screenY - event.clientY * geometry.zoom,
      geomKey: geometryKey(geometry),
    }

    // event.screenX/Y ARE the click's global screen position — use directly
    chrome.runtime.sendMessage(
      {
        type: 'gaze_click_anchor',
        screenX: event.screenX,
        screenY: event.screenY,
        ts: Date.now(),
      },
      () => {
        if (chrome.runtime.lastError) { /* non-fatal */ }
      },
    )
  }

  // Route change callback — an SPA navigation fires an immediate slice with
  // trigger 'navigation' (server closes the current Page, opens a new one) and
  // resets the slice clock.
  const routeChangeCallback = (_url: string): void => {
    if (heatmapEnabled) {
      heatmapOverlay.clear()
    }
    sliceManager.triggerNavigationSlice()
  }

  // -----------------------------------------------------------------------
  // Lifecycle helpers
  // -----------------------------------------------------------------------

  async function startTracking(
    sid: string,
    _settings: ExtensionSettings,
    enableHeatmap?: boolean,
  ): Promise<void> {
    if (isTracking) return

    sessionId = sid
    isTracking = true
    isPaused = false
    heatmapEnabled = enableHeatmap ?? false

    // 1. Start DOM version tracking (must be first — other subsystems read it)
    startDomVersionTracking()

    // 2. Start SPA detection
    spaDetector.start()
    spaDetector.onRouteChange(routeChangeCallback)

    // 3. Start the slice clock (gaze accumulation + cadence + delivery)
    sliceManager.start(sessionId)

    // 4. Gaze samples now arrive via messages from service worker (offscreen gaze engine)

    if (heatmapEnabled) {
      heatmapOverlay.start()
    }

    // 6. Click anchors for drift correction
    window.addEventListener('mousedown', clickAnchorListener, true)

    gazePointCount = 0
    console.log('[GazeKit] ✓ Tracking started for session', sessionId, heatmapEnabled ? '(heatmap ON)' : '(heatmap OFF)')
    console.log('[GazeKit] Waiting for gaze_samples from service worker...')
  }

  function stopTracking(): void {
    if (!isTracking && !sessionId) return

    if (heatmapEnabled) {
      heatmapOverlay.stop()
    }

    // Tear down in reverse order (gaze engine runs in offscreen — no local cleanup)
    window.removeEventListener('mousedown', clickAnchorListener, true)
    sliceManager.stop()

    spaDetector.offRouteChange(routeChangeCallback)
    spaDetector.stop()

    stopDomVersionTracking()

    sessionId = null
    isTracking = false
    isPaused = false
    heatmapEnabled = false

    console.log('[GazeKit] Tracking stopped')
  }

  function pauseTracking(): void {
    if (!isTracking || isPaused) return

    isPaused = true
    sliceManager.pause()

    chrome.runtime.sendMessage(
      { type: 'tracking_status', status: 'paused' },
      () => {
        if (chrome.runtime.lastError) {
          // Service worker may have restarted — non-fatal
        }
      },
    )

    console.log('[GazeKit] Tracking paused')
  }

  function resumeTracking(): void {
    if (!isTracking || !isPaused) return

    isPaused = false
    sliceManager.resume()

    chrome.runtime.sendMessage(
      { type: 'tracking_status', status: 'active' },
      () => {
        if (chrome.runtime.lastError) {
          // Service worker may have restarted — non-fatal
        }
      },
    )

    console.log('[GazeKit] Tracking resumed')
  }

  // -----------------------------------------------------------------------
  // Message listener — receives commands from the service worker
  // -----------------------------------------------------------------------

  chrome.runtime.onMessage.addListener(
    (
      message: ServiceWorkerToContentMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void,
    ): boolean | undefined => {
      switch (message.type) {
        case 'start_tracking': {
          startTracking(message.sessionId, message.settings, message.heatmapEnabled)
            .then(() => sendResponse({
              success: true,
              screen: { width: screen.width, height: screen.height },
              viewport: { width: window.innerWidth, height: window.innerHeight },
              dpr: window.devicePixelRatio,
            }))
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : 'Unknown error'
              sendResponse({ success: false, error: msg })
            })
          break
        }

        case 'stop_tracking': {
          stopTracking()
          sendResponse({ success: true })
          break
        }

        case 'pause_tracking': {
          pauseTracking()
          sendResponse({ success: true })
          break
        }

        case 'resume_tracking': {
          resumeTracking()
          sendResponse({ success: true })
          break
        }

        case 'gaze_samples': {
          // Gaze samples from offscreen engine, forwarded by service worker.
          // Drop them when this tab isn't visible — otherwise minutes of gaze
          // aimed at another tab/window get baked into this page's heatmap.
          if (isTracking && !isPaused && document.visibilityState === 'visible') {
            for (const sample of message.samples) {
              gazeCallback(sample)
            }
          }
          sendResponse({ received: true })
          break
        }

        case 'zoom_update': {
          zoomFactor = message.zoomFactor > 0 ? message.zoomFactor : 1
          sendResponse({ received: true })
          break
        }

        case 'navigation_slice': {
          if (isTracking && !isPaused) {
            sliceManager.triggerNavigationSlice()
          }
          sendResponse({ received: true })
          break
        }

        default: {
          // Unknown message — don't respond so other listeners can handle it
          return undefined
        }
      }

      // Return true to keep the message channel open for async responses
      return true
    },
  )

  console.log('[GazeKit] Content script initialized')
}
