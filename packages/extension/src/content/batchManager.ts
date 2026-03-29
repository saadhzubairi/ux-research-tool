// ---------------------------------------------------------------------------
// Gaze Batch Manager
// Accumulates GazeEvents in a buffer, flushing them as GazeBatch messages
// to the service worker at a configurable interval (default 1 s).
// Failed batches are retained and retried on the next flush cycle.
// ---------------------------------------------------------------------------

import type {
  GazeEvent,
  GazeBatch,
  GazeSample,
  GazeContext,
} from '@gazekit/shared'
import { WS_CONFIG, GAZE_CONFIDENCE_THRESHOLD } from '@gazekit/shared'
import { mapGazeToElement } from './domMapper'
import { getDomVersion } from './domVersionTracker'

const MAX_FAILED_BATCHES = 30 // ~30 seconds of data at 1-s intervals

class BatchManager {
  private buffer: GazeEvent[] = []
  private batchIndex = 0
  private intervalId: ReturnType<typeof setInterval> | null = null
  private sessionId = ''
  private failedBatches: GazeBatch[] = []

  start(sessionId: string, intervalMs = WS_CONFIG.BATCH_INTERVAL_MS): void {
    this.sessionId = sessionId
    this.batchIndex = 0
    this.buffer = []
    this.failedBatches = []

    this.intervalId = setInterval(() => this.flush(), intervalMs)
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    // Flush remaining buffer before stopping
    this.flush()
  }

  pause(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    // Do NOT flush on pause — keep buffered data for when we resume
  }

  resume(intervalMs = WS_CONFIG.BATCH_INTERVAL_MS): void {
    if (this.intervalId) return // Already running
    this.intervalId = setInterval(() => this.flush(), intervalMs)
  }

  addSample(sample: GazeSample): void {
    // Drop low-confidence samples
    if (sample.conf !== null && sample.conf < GAZE_CONFIDENCE_THRESHOLD) return

    const element = mapGazeToElement(sample)
    const context = this.captureContext()

    this.buffer.push({ sample, element, context })
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private flush(): void {
    if (this.buffer.length === 0 && this.failedBatches.length === 0) return

    // Retry previously failed batches first
    const retries = [...this.failedBatches]
    this.failedBatches = []

    for (const batch of retries) {
      this.sendBatch(batch)
    }

    // Send current buffer
    if (this.buffer.length > 0) {
      const batch: GazeBatch = {
        type: 'gaze_batch',
        sessionId: this.sessionId,
        events: [...this.buffer],
        batchIndex: this.batchIndex++,
      }
      this.buffer = []
      this.sendBatch(batch)
    }
  }

  private sendBatch(batch: GazeBatch): void {
    console.log(`[GazeKit] Sending gaze_batch #${batch.batchIndex}: ${batch.events.length} events`)
    chrome.runtime.sendMessage(
      { type: 'gaze_batch', payload: batch },
      (response: unknown) => {
        if (chrome.runtime.lastError) {
          console.warn(
            '[GazeKit] Batch send failed:',
            chrome.runtime.lastError.message,
          )
          this.requeueBatch(batch)
          return
        }
        const res = response as Record<string, unknown> | undefined
        if (!res || res['error']) {
          console.warn('[GazeKit] Batch response error:', res)
          this.requeueBatch(batch)
        } else {
          console.log(`[GazeKit] ✓ Batch #${batch.batchIndex} forwarded`)
        }
      },
    )
  }

  private requeueBatch(batch: GazeBatch): void {
    if (this.failedBatches.length < MAX_FAILED_BATCHES) {
      this.failedBatches.push(batch)
    }
    // Beyond MAX_FAILED_BATCHES we silently drop — prevents unbounded growth
  }

  private captureContext(): GazeContext {
    return {
      url: location.href.split('#')[0] ?? location.href,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      docWidth: document.documentElement.scrollWidth,
      docHeight: document.documentElement.scrollHeight,
      domVersion: getDomVersion(),
      dpr: window.devicePixelRatio,
    }
  }
}

export const batchManager = new BatchManager()
