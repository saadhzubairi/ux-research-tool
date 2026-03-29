import type { GazeBatch, CalibrationResult, SessionMeta } from './gaze'

export type ExtensionMessage =
  | { type: 'session_start'; payload: SessionMeta }
  | { type: 'gaze_batch'; payload: GazeBatch }
  | { type: 'rrweb_events'; payload: { sessionId: string; events: any[] } }
  | { type: 'page_screenshot'; payload: { sessionId: string; url: string; dataUrl: string; scrollY: number; viewportHeight: number } }
  | { type: 'calibration_update'; payload: { sessionId: string; calibration: CalibrationResult } }
  | { type: 'session_end'; payload: { sessionId: string; endedAt: string; stats: SessionMeta['stats'] } }
  | { type: 'heartbeat'; payload: { sessionId: string; ts: number } }

export type ServerMessage =
  | { type: 'ack'; payload: { messageType: string; received: number } }
  | { type: 'error'; payload: { code: string; message: string } }
  | { type: 'command'; payload: { action: 'recalibrate' | 'pause' | 'resume' | 'stop' } }

export const WS_CONFIG = {
  PORT: 8765,
  KEEPALIVE_INTERVAL_MS: 20_000,
  RECONNECT_DELAY_MS: 3_000,
  MAX_RECONNECT_ATTEMPTS: 10,
  BATCH_INTERVAL_MS: 250,
} as const
