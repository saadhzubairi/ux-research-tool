// ---------------------------------------------------------------------------
// Slice Manager
// ---------------------------------------------------------------------------
// Owns the single "slice clock" that replaces the old fixed-interval gaze
// BatchManager timer AND the service worker's decoupled screenshot timer.
//
// On each tick it drains the gaze points accumulated since the last tick and
// hands them to the background as a `slice` message. The background forwards
// to the offscreen document, which grabs the current tab-capture frame and
// sends the assembled slice (gaze + screenshot on one clock) over the WS.
//
// Cadence adapts to scrolling: 100ms normal, 1000ms while scrolling (a
// fixation mid-scroll is ~1s of near-identical viewport — bursting screenshots
// there is wasted cost). Navigation fires an immediate slice and resets the
// clock so the next interval slice is a full cadence later.
//
// The content script owns this (not the service worker) because it has direct,
// low-latency access to scroll state, scroll/viewport geometry and the DOM.
// ---------------------------------------------------------------------------

import type { GazeSample } from '@gazekit/shared'
import type { GazePoint } from '@gazekit/shared'
import { GAZE_CONFIDENCE_THRESHOLD, normalizeGazeUrl } from '@gazekit/shared'
import type { SliceCapture, SliceTrigger } from '../types/extension'
import { mapGazeToElement } from './domMapper'

const CADENCE_NORMAL_MS = 100
const CADENCE_SCROLLING_MS = 1000
const SCROLL_DEBOUNCE_MS = 50 // "scrolling is happening" vs a single jump
const SCROLL_IDLE_MS = 300 // no scroll event for this long → back to normal

class SliceManager {
  private buffer: GazePoint[] = []
  private sessionId = ''
  private cadenceMs = CADENCE_NORMAL_MS
  private tickTimer: ReturnType<typeof setTimeout> | null = null
  private running = false

  // Trigger carried by the NEXT slice. Defaults to 'interval'; a scroll or
  // navigation event promotes it for exactly one slice.
  private nextTrigger: SliceTrigger = 'interval'

  // Scroll state
  private isScrolling = false
  private scrollDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private scrollIdleTimer: ReturnType<typeof setTimeout> | null = null
  private boundScrollListener: (() => void) | null = null

  start(sessionId: string): void {
    this.sessionId = sessionId
    this.buffer = []
    this.cadenceMs = CADENCE_NORMAL_MS
    this.nextTrigger = 'interval'
    this.isScrolling = false
    this.running = true

    this.boundScrollListener = () => this.onScroll()
    window.addEventListener('scroll', this.boundScrollListener, { passive: true, capture: true })

    this.scheduleTick()
  }

  stop(): void {
    this.running = false
    this.clearTickTimer()
    this.clearScrollTimers()
    if (this.boundScrollListener) {
      window.removeEventListener('scroll', this.boundScrollListener, true)
      this.boundScrollListener = null
    }
    // Flush whatever is buffered before shutting down
    this.emitSlice('interval')
    this.buffer = []
  }

  pause(): void {
    this.running = false
    this.clearTickTimer()
    // Keep buffered points for resume — do NOT flush
  }

  resume(): void {
    if (this.running) return
    this.running = true
    this.scheduleTick()
  }

  addSample(sample: GazeSample): void {
    // Drop low-confidence samples (same gate BatchManager applied)
    if (sample.conf !== null && sample.conf < GAZE_CONFIDENCE_THRESHOLD) return
    const element = mapGazeToElement(sample)
    this.buffer.push({ sample, element })
  }

  /**
   * Emit an immediate slice for a navigation (SPA route change or full-page
   * load) and reset the interval clock so the next interval slice is a full
   * cadence later, not fired back-to-back.
   */
  triggerNavigationSlice(): void {
    if (!this.running) return
    this.emitSlice('navigation')
    this.scheduleTick() // reset the clock
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private scheduleTick(): void {
    this.clearTickTimer()
    this.tickTimer = setTimeout(() => this.onTick(), this.cadenceMs)
  }

  private onTick(): void {
    if (!this.running) return
    this.emitSlice(this.nextTrigger)
    this.nextTrigger = 'interval'
    this.scheduleTick()
  }

  private emitSlice(trigger: SliceTrigger): void {
    // Always emit on a tick: a slice with zero gaze points is still a valid
    // visual sample (the screenshot is the point during pure-scroll windows).
    const gazePoints = this.buffer
    this.buffer = []

    const payload: SliceCapture = {
      sessionId: this.sessionId,
      trigger,
      capturedAt: Date.now(),
      url: normalizeGazeUrl(location.href),
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      gazePoints,
    }

    chrome.runtime.sendMessage({ type: 'slice', payload }, () => {
      if (chrome.runtime.lastError) {
        // Service worker may be asleep/restarting — non-fatal, drop this slice.
        // Slices carry a live screenshot grabbed at send time, so requeuing a
        // stale slice would pair old gaze with a fresh (wrong) frame.
        console.warn('[GazeKit] Slice send failed:', chrome.runtime.lastError.message)
      }
    })
  }

  // -------------------------------------------------------------------------
  // Scroll cadence
  // -------------------------------------------------------------------------

  private onScroll(): void {
    // Debounce entry so a single wheel notch / anchor jump doesn't flip cadence
    if (this.scrollDebounceTimer === null) {
      this.scrollDebounceTimer = setTimeout(() => {
        this.scrollDebounceTimer = null
        this.enterScrolling()
      }, SCROLL_DEBOUNCE_MS)
    }

    // Reset the idle timer on every scroll event
    if (this.scrollIdleTimer !== null) clearTimeout(this.scrollIdleTimer)
    this.scrollIdleTimer = setTimeout(() => this.exitScrolling(), SCROLL_IDLE_MS)
  }

  private enterScrolling(): void {
    if (this.isScrolling) return
    this.isScrolling = true
    this.cadenceMs = CADENCE_SCROLLING_MS
    this.nextTrigger = 'scroll'
    // Re-arm the clock at the slower cadence immediately rather than waiting
    // out the remainder of a 100ms tick.
    if (this.running) this.scheduleTick()
  }

  private exitScrolling(): void {
    if (this.scrollIdleTimer !== null) {
      clearTimeout(this.scrollIdleTimer)
      this.scrollIdleTimer = null
    }
    if (!this.isScrolling) return
    this.isScrolling = false
    this.cadenceMs = CADENCE_NORMAL_MS
    if (this.running) this.scheduleTick()
  }

  private clearTickTimer(): void {
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer)
      this.tickTimer = null
    }
  }

  private clearScrollTimers(): void {
    if (this.scrollDebounceTimer !== null) {
      clearTimeout(this.scrollDebounceTimer)
      this.scrollDebounceTimer = null
    }
    if (this.scrollIdleTimer !== null) {
      clearTimeout(this.scrollIdleTimer)
      this.scrollIdleTimer = null
    }
  }
}

export const sliceManager = new SliceManager()
