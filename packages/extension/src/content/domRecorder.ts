// ---------------------------------------------------------------------------
// DOM Recorder
// Wraps rrweb to capture a full DOM recording. Includes a custom rrweb
// plugin that embeds gaze samples into the replay timeline.
// ---------------------------------------------------------------------------

import type { GazeSample } from '@gazekit/shared'

type RrwebStopFn = () => void

// ---------------------------------------------------------------------------
// Gaze Emitter — lightweight pub/sub so the rrweb plugin can consume
// gaze samples without coupling directly to gazeEngine.
// ---------------------------------------------------------------------------

type GazeHandler = (sample: GazeSample) => void

class GazeEmitter {
  private listeners: GazeHandler[] = []

  on(callback: GazeHandler): void {
    this.listeners.push(callback)
  }

  off(callback: GazeHandler): void {
    this.listeners = this.listeners.filter((cb) => cb !== callback)
  }

  emit(sample: GazeSample): void {
    for (const cb of this.listeners) {
      try {
        cb(sample)
      } catch (err) {
        console.error('[GazeKit] GazeEmitter listener error:', err)
      }
    }
  }

  clear(): void {
    this.listeners = []
  }
}

export const gazeEmitter = new GazeEmitter()

// ---------------------------------------------------------------------------
// rrweb record function typing (minimal surface we use)
// ---------------------------------------------------------------------------

interface RrwebRecordOptions {
  emit: (event: unknown) => void
  sampling?: {
    mousemove?: boolean
    mouseInteraction?: boolean
    scroll?: number
    input?: 'last' | 'all'
  }
  recordCanvas?: boolean
  collectFonts?: boolean
  maskAllInputs?: boolean
  blockSelector?: string
  checkoutEveryNms?: number
  plugins?: unknown[]
}

// ---------------------------------------------------------------------------
// DomRecorder
// ---------------------------------------------------------------------------

class DomRecorder {
  private stopFn: RrwebStopFn | null = null
  private eventBuffer: unknown[] = []
  private flushInterval: ReturnType<typeof setInterval> | null = null
  private batchIndex = 0
  private sessionId = ''

  async start(sessionId: string): Promise<void> {
    this.sessionId = sessionId
    this.batchIndex = 0
    this.eventBuffer = []

    try {
      const rrweb = await import('rrweb')

      // Custom rrweb plugin: embeds gaze coordinates in the replay timeline
      const gazePlugin = {
        name: 'gazekit/gaze@1',
        observer(cb: (payload: unknown) => void) {
          const handler = (data: GazeSample) =>
            cb({ x: data.x, y: data.y, conf: data.conf })
          gazeEmitter.on(handler)
          return () => gazeEmitter.off(handler)
        },
        options: {},
      }

      const recordFn = (rrweb.record ?? (rrweb as unknown as { default: { record: unknown } }).default?.record) as (
        opts: RrwebRecordOptions,
      ) => RrwebStopFn

      this.stopFn = recordFn({
        emit: (event: unknown) => {
          this.eventBuffer.push(event)
        },
        sampling: {
          mousemove: false,
          mouseInteraction: true,
          scroll: 150,
          input: 'last',
        },
        recordCanvas: false,
        collectFonts: false,
        maskAllInputs: true,
        blockSelector: '.gazekit-ignore',
        checkoutEveryNms: 60_000, // Full DOM snapshot every 60 s
        plugins: [gazePlugin],
      })

      // Flush buffered rrweb events to service worker every 2 seconds
      this.flushInterval = setInterval(() => this.flush(), 2000)
    } catch (err) {
      console.error('[GazeKit] Failed to start rrweb recording:', err)
    }
  }

  stop(): void {
    if (this.stopFn) {
      try {
        this.stopFn()
      } catch (err) {
        console.error('[GazeKit] Error stopping rrweb:', err)
      }
      this.stopFn = null
    }

    if (this.flushInterval) {
      clearInterval(this.flushInterval)
      this.flushInterval = null
    }

    // Send any remaining events
    this.flush()
    gazeEmitter.clear()
  }

  private flush(): void {
    if (this.eventBuffer.length === 0) return

    const events = [...this.eventBuffer]
    this.eventBuffer = []

    chrome.runtime.sendMessage(
      {
        type: 'rrweb_events',
        payload: {
          sessionId: this.sessionId,
          events,
          batchIndex: this.batchIndex++,
        },
      },
      () => {
        // Acknowledge — if the service worker is unavailable the events are
        // lost, which is acceptable for DOM recording data.
        if (chrome.runtime.lastError) {
          console.warn(
            '[GazeKit] Failed to send rrweb events:',
            chrome.runtime.lastError.message,
          )
        }
      },
    )
  }
}

export const domRecorder = new DomRecorder()
