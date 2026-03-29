import type {
  GazeBatch,
  GazeSample,
  CalibrationResult,
  ExtensionMessage,
} from '@gazekit/shared'

// ---------------------------------------------------------------------------
// Extension settings stored in chrome.storage.local
// ---------------------------------------------------------------------------

export interface ExtensionSettings {
  wsPort: number
  batchIntervalMs: number
  screenshotIntervalMs: number
  dashboardUrl: string
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  wsPort: 8765,
  batchIntervalMs: 1000,
  screenshotIntervalMs: 5000,
  dashboardUrl: 'http://localhost:3000',
}

// ---------------------------------------------------------------------------
// Internal extension state
// ---------------------------------------------------------------------------

export interface ExtensionState {
  currentSessionId: string | null
  isTracking: boolean
  isPaused: boolean
  wsStatus: 'connected' | 'disconnected' | 'reconnecting'
  activeTabId: number | null
  activeTabUrl: string | null
  lastCalibration: CalibrationResult | null
}

// ---------------------------------------------------------------------------
// Messages from popup to service worker
// ---------------------------------------------------------------------------

export type PopupMessage =
  | { type: 'start_session'; targetTabId?: number }
  | { type: 'stop_session' }
  | { type: 'pause_tracking' }
  | { type: 'resume_tracking' }
  | { type: 'get_status' }
  | { type: 'open_calibration' }
  | { type: 'update_settings'; settings: Partial<ExtensionSettings> }
  | { type: 'calibration_complete'; calibration: CalibrationResult }

// ---------------------------------------------------------------------------
// Messages from content script to service worker
// ---------------------------------------------------------------------------

export type ContentMessage =
  | { type: 'gaze_batch'; payload: GazeBatch }
  | { type: 'rrweb_events'; payload: { sessionId: string; events: unknown[] } }
  | { type: 'tracking_status'; status: 'active' | 'paused' | 'error'; error?: string }
  | { type: 'page_change'; url: string; heatmapDataUrl?: string }

// ---------------------------------------------------------------------------
// Messages from offscreen to service worker
// ---------------------------------------------------------------------------

export type OffscreenMessage =
  | { type: 'ws_status_change'; status: 'connected' | 'disconnected' | 'reconnecting' }
  | { type: 'server_command'; action: 'recalibrate' | 'pause' | 'resume' | 'stop' }
  | { type: 'gaze_samples'; samples: GazeSample[] }
  | { type: 'get_calibration_model' }

// ---------------------------------------------------------------------------
// Messages from service worker to content script
// ---------------------------------------------------------------------------

export type ServiceWorkerToContentMessage =
  | { type: 'start_tracking'; sessionId: string; settings: ExtensionSettings; heatmapEnabled?: boolean }
  | { type: 'stop_tracking' }
  | { type: 'pause_tracking' }
  | { type: 'resume_tracking' }
  | { type: 'gaze_samples'; samples: GazeSample[] }

// ---------------------------------------------------------------------------
// Messages from service worker to offscreen
// ---------------------------------------------------------------------------

export type ServiceWorkerToOffscreenMessage =
  | { type: 'connect'; port: number }
  | { type: 'disconnect' }
  | { type: 'send'; message: ExtensionMessage }
  | { type: 'start_gaze' }
  | { type: 'stop_gaze' }

// ---------------------------------------------------------------------------
// Status response from service worker to popup
// ---------------------------------------------------------------------------

export interface ExtensionStatus {
  isTracking: boolean
  isPaused: boolean
  currentSessionId: string | null
  wsStatus: 'connected' | 'disconnected' | 'reconnecting'
  activeTabId: number | null
  activeTabUrl: string | null
  lastCalibration: CalibrationResult | null
  settings: ExtensionSettings
}

// ---------------------------------------------------------------------------
// Union of all inbound messages the service worker can receive
// ---------------------------------------------------------------------------

export type InboundMessage = PopupMessage | ContentMessage | OffscreenMessage
