import type {
  CalibrationResult,
  SessionMeta,
  GazePoint,
  SliceTrigger,
  SliceListItem,
  SliceFixation,
} from './gaze'

/**
 * A single capture tick sent from the extension. Replaces the old
 * `gaze_batch` + `page_screenshot` + `page_change` messages: every field that
 * used to be duplicated per gaze point (url, scroll, viewport) now lives on
 * the slice envelope since it's constant across the slice's capture window.
 */
export interface SlicePayload {
  sessionId: string
  trigger: SliceTrigger
  capturedAt: number // epoch ms
  url: string // normalized client-side; server re-normalizes belt-and-suspenders
  scrollX: number
  scrollY: number
  viewportWidth: number
  viewportHeight: number
  gazePoints: GazePoint[]
  screenshotDataUrl: string // always fresh — sampled from the tabCapture stream
}

// Extension → server
export type ExtensionMessage =
  | { type: 'session_start'; payload: SessionMeta }
  | { type: 'slice'; payload: SlicePayload }
  | { type: 'calibration_update'; payload: { sessionId: string; calibration: CalibrationResult } }
  | { type: 'session_end'; payload: { sessionId: string; endedAt: string; stats: SessionMeta['stats'] } }
  | { type: 'heartbeat'; payload: { sessionId: string; ts: number } }

// Server → extension
export type ServerMessage =
  | { type: 'ack'; payload: { messageType: string; received: number } }
  | { type: 'error'; payload: { code: string; message: string } }
  | { type: 'command'; payload: { action: 'recalibrate' | 'pause' | 'resume' | 'stop' } }

// Dashboard client → server: live-heatmap subscription control
export type DashboardMessage =
  | { type: 'subscribe'; payload: { sessionId: string } }
  | { type: 'unsubscribe'; payload: { sessionId: string } }

// Server → dashboard client: progressive slice push
export type DashboardPushMessage =
  // A slice landed (fixations may still be null — computed async at ingest).
  | {
      type: 'slice_ingested'
      payload: { sessionId: string; pageId: string; slice: SliceListItem }
    }
  // Fixations for an already-ingested slice finished computing.
  | {
      type: 'slice_updated'
      payload: {
        sessionId: string
        pageId: string
        sliceIndex: number
        fixations: SliceFixation[]
      }
    }

export const WS_CONFIG = {
  PORT: 8765,
  KEEPALIVE_INTERVAL_MS: 20_000,
  RECONNECT_DELAY_MS: 3_000,
  MAX_RECONNECT_ATTEMPTS: 10,
  BATCH_INTERVAL_MS: 250,
} as const
