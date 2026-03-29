// ---------------------------------------------------------------------------
// GazeKit Content Script Entry Point
// ---------------------------------------------------------------------------
// Injected by the service worker via chrome.scripting.executeScript.
// Initializes and coordinates all subsystems:
//   - batchManager — gaze event batching & delivery
//   - domRecorder  — rrweb DOM recording with gaze plugin
//   - spaDetector  — client-side route change detection
//   - domVersionTracker — significant DOM mutation counter
//   - heatmapOverlay — live heatmap canvas
//
// Gaze samples arrive via messages from the offscreen document (where
// WebGazer runs inside a sandboxed iframe to satisfy CSP requirements).
//
// Idempotent: re-injection does not create duplicate trackers.
// ---------------------------------------------------------------------------

import type { GazeSample } from '@gazekit/shared'
import type {
  ServiceWorkerToContentMessage,
  ExtensionSettings,
} from '../types/extension'
import { batchManager } from './batchManager'
import { domRecorder, gazeEmitter } from './domRecorder'
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

  // The gaze callback reference — kept so we can unsubscribe on stop
  const gazeCallback = (sample: GazeSample): void => {
    gazePointCount++
    batchManager.addSample(sample)
    gazeEmitter.emit(sample) // Feed rrweb gaze plugin
    if (heatmapEnabled) {
      heatmapOverlay.addPoint(sample.x, sample.y)
    }
    // Debug logging — first 10 points, then every 100th
    if (gazePointCount <= 10 || gazePointCount % 100 === 0) {
      console.log(`[GazeKit] 👁 Heatmap point #${gazePointCount}: [${Math.round(sample.x)}, ${Math.round(sample.y)}] heatmap=${heatmapEnabled}`)
    }
  }

  // Route change callback — reports SPA navigations to service worker
  const routeChangeCallback = (url: string): void => {
    let heatmapDataUrl: string | undefined
    if (heatmapEnabled) {
      heatmapDataUrl = heatmapOverlay.snapshot()
      heatmapOverlay.clear()
    }
    chrome.runtime.sendMessage({ type: 'page_change', url, heatmapDataUrl }, () => {
      if (chrome.runtime.lastError) {
        console.warn(
          '[GazeKit] Failed to send page_change:',
          chrome.runtime.lastError.message,
        )
      }
    })
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

    // 3. Start batch manager
    batchManager.start(sessionId)

    // 4. Start rrweb DOM recorder
    await domRecorder.start(sessionId)

    // 5. Gaze samples now arrive via messages from service worker (offscreen gaze engine)

    if (heatmapEnabled) {
      heatmapOverlay.start()
    }

    gazePointCount = 0
    console.log('[GazeKit] ✓ Tracking started for session', sessionId, heatmapEnabled ? '(heatmap ON)' : '(heatmap OFF)')
    console.log('[GazeKit] Waiting for gaze_samples from service worker...')
  }

  function stopTracking(): void {
    if (!isTracking && !sessionId) return

    // Snapshot heatmap before teardown
    if (heatmapEnabled) {
      try {
        const heatmapDataUrl = heatmapOverlay.snapshot()
        if (heatmapDataUrl) {
          chrome.runtime.sendMessage(
            { type: 'page_change', url: location.href, heatmapDataUrl },
            () => { if (chrome.runtime.lastError) { /* non-fatal */ } },
          )
        }
      } catch { /* non-fatal */ }
      heatmapOverlay.stop()
    }

    // Tear down in reverse order (gaze engine runs in offscreen — no local cleanup)
    domRecorder.stop()
    batchManager.stop()

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
    batchManager.pause()

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
    batchManager.resume()

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
          // Gaze samples from offscreen engine, forwarded by service worker
          if (isTracking && !isPaused) {
            for (const sample of message.samples) {
              gazeCallback(sample)
            }
          } else {
            console.warn('[GazeKit] gaze_samples dropped: isTracking=', isTracking, 'isPaused=', isPaused)
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

  // Capture heatmap on full-page navigation (content script about to be destroyed)
  window.addEventListener('beforeunload', () => {
    if (heatmapEnabled && isTracking) {
      try {
        const heatmapDataUrl = heatmapOverlay.snapshot()
        if (heatmapDataUrl) {
          chrome.runtime.sendMessage({ type: 'page_change', url: location.href, heatmapDataUrl })
        }
      } catch { /* race — best effort */ }
    }
  })

  console.log('[GazeKit] Content script initialized')
}
