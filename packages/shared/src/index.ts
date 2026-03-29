// Types
export type {
  GazeSample,
  GazeElement,
  GazeEvent,
  GazeContext,
  GazeBatch,
  CalibrationResult,
  SessionMeta,
  Fixation,
  HeatmapPoint,
  ExtensionMessage,
  ServerMessage,
  ApiResponse,
  SessionsQuery,
  HeatmapData,
  ReplayData,
  ElementAttention,
} from './types'

export { WS_CONFIG } from './types'

// Constants
export {
  CALIBRATION_POINTS_9,
  CALIBRATION_POINTS_13,
  GAZE_CONFIDENCE_THRESHOLD,
  FIXATION_DISPERSION_THRESHOLD_PX,
  FIXATION_DURATION_THRESHOLD_MS,
  HEATMAP_BLUR_RADIUS,
  MAX_SELECTOR_DEPTH,
} from './constants'

// Utils
export {
  viewportToDocument,
  viewportToNormalized,
  normalizedToViewport,
  detectFixations,
  generateSelector,
} from './utils'
