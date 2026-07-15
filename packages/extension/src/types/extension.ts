import type {
  GazeSample,
  CalibrationResult,
  ExtensionMessage,
  SlicePayload,
  SliceTrigger,
} from '@gazekit/shared'

// A slice as produced by the content script: the full public SlicePayload
// minus the screenshot, which the offscreen document fills in from the
// tab-capture canvas right before sending over the WS.
export type SliceCapture = Omit<SlicePayload, 'screenshotDataUrl'>

export type { SliceTrigger }

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
  screenshotIntervalMs: 1000,
  dashboardUrl: 'http://localhost:4444',
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
  | { type: 'slice'; payload: SliceCapture }
  | { type: 'tracking_status'; status: 'active' | 'paused' | 'error'; error?: string }
  | { type: 'gaze_click_anchor'; screenX: number; screenY: number; ts: number }

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
  | { type: 'zoom_update'; zoomFactor: number }
  // Fired after a full-page navigation re-attaches tracking: the fresh content
  // script emits one immediate slice with trigger 'navigation'.
  | { type: 'navigation_slice' }

// ---------------------------------------------------------------------------
// Messages from service worker to offscreen
// ---------------------------------------------------------------------------

export type ServiceWorkerToOffscreenMessage =
  | { type: 'ping' }
  | { type: 'connect'; port: number }
  | { type: 'disconnect' }
  | { type: 'send'; message: ExtensionMessage }
  | { type: 'start_gaze' }
  | { type: 'stop_gaze' }
  | { type: 'click_anchor'; screenX: number; screenY: number; ts: number }
  // Tab-capture stream lifecycle + slice send (the offscreen doc owns the
  // tab-capture canvas and the WS client, so it grabs the frame and sends the
  // assembled slice in one hop).
  | { type: 'start_tab_stream'; streamId: string }
  | { type: 'stop_tab_stream' }
  | { type: 'send_slice'; payload: SliceCapture }

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
