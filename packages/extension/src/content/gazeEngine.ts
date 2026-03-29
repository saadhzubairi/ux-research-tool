// ---------------------------------------------------------------------------
// Gaze Engine
// Wraps WebGazer.js — handles initialization, gaze sample collection,
// FPS tracking, and face-loss detection.
// ---------------------------------------------------------------------------

import type { GazeSample } from '@gazekit/shared'

type GazeCallback = (sample: GazeSample) => void

// WebGazer API surface we consume (typed minimally to avoid `any`)
interface WebGazerInstance {
  setRegression(type: string): WebGazerInstance
  setTracker(type: string): WebGazerInstance
  applyKalmanFilter(apply: boolean): WebGazerInstance
  showVideoPreview(show: boolean): WebGazerInstance
  showPredictionPoints(show: boolean): WebGazerInstance
  setGazeListener(
    cb: (data: { x: number; y: number } | null, elapsedTime: number) => void,
  ): WebGazerInstance
  begin(): Promise<void>
  end(): void
  pause(): void
  resume(): void
}

class GazeEngine {
  private listeners: GazeCallback[] = []
  private isRunning = false
  private trackingLossCount = 0
  private lastSampleTs = 0
  private avgFps = 0
  private sampleCount = 0
  private webgazerInstance: WebGazerInstance | null = null

  async start(): Promise<void> {
    if (this.isRunning) return

    try {
      // Dynamic import — WebGazer is bundled as an extension dependency
      const webgazer = await import('webgazer')
      const wg = (webgazer.default ?? webgazer) as unknown as WebGazerInstance

      wg.setRegression('ridge')
        .setTracker('TFFacemesh')
        .applyKalmanFilter(true)
        .showVideoPreview(false)
        .showPredictionPoints(false)

      wg.setGazeListener(
        (data: { x: number; y: number } | null, _elapsedTime: number) => {
          if (!data) {
            this.trackingLossCount++
            // ~3 seconds at 25 fps
            if (this.trackingLossCount > 135) {
              chrome.runtime.sendMessage({
                type: 'tracking_status',
                status: 'error',
                error: 'Face not detected',
              })
            }
            return
          }

          this.trackingLossCount = 0
          const now = performance.now()

          // Exponential moving average for FPS
          if (this.lastSampleTs > 0) {
            const dt = now - this.lastSampleTs
            if (dt > 0) {
              this.avgFps = this.avgFps * 0.95 + (1000 / dt) * 0.05
            }
          }
          this.lastSampleTs = now
          this.sampleCount++

          const sample: GazeSample = {
            x: data.x,
            y: data.y,
            ts: Date.now(),
            conf: null, // WebGazer does not expose per-sample confidence
          }

          for (const cb of this.listeners) {
            try {
              cb(sample)
            } catch (err) {
              console.error('[GazeKit] Gaze listener error:', err)
            }
          }
        },
      )

      await wg.begin()
      this.webgazerInstance = wg
      this.isRunning = true

      chrome.runtime.sendMessage({
        type: 'tracking_status',
        status: 'active',
      })
    } catch (err) {
      console.error('[GazeKit] Failed to start WebGazer:', err)
      chrome.runtime.sendMessage({
        type: 'tracking_status',
        status: 'error',
        error: err instanceof Error ? err.message : 'WebGazer init failed',
      })
      throw err
    }
  }

  stop(): void {
    if (this.webgazerInstance) {
      try {
        this.webgazerInstance.end()
      } catch (err) {
        console.error('[GazeKit] Error stopping WebGazer:', err)
      }
      this.webgazerInstance = null
    }
    this.isRunning = false
    this.listeners = []
    this.trackingLossCount = 0
    this.lastSampleTs = 0
    this.avgFps = 0
    this.sampleCount = 0
  }

  pause(): void {
    if (this.webgazerInstance) {
      try {
        this.webgazerInstance.pause()
      } catch (err) {
        console.error('[GazeKit] Error pausing WebGazer:', err)
      }
    }
  }

  resume(): void {
    if (this.webgazerInstance) {
      try {
        this.webgazerInstance.resume()
      } catch (err) {
        console.error('[GazeKit] Error resuming WebGazer:', err)
      }
    }
  }

  onSample(callback: GazeCallback): void {
    this.listeners.push(callback)
  }

  offSample(callback: GazeCallback): void {
    this.listeners = this.listeners.filter((cb) => cb !== callback)
  }

  getStats(): { avgFps: number; sampleCount: number } {
    return { avgFps: this.avgFps, sampleCount: this.sampleCount }
  }

  getIsRunning(): boolean {
    return this.isRunning
  }
}

export const gazeEngine = new GazeEngine()
