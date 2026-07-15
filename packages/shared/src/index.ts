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
  // Page / Slice model
  SliceTrigger,
  GazePoint,
  SliceGazeElement,
  SliceGazePoint,
  SliceScreenshot,
  SliceFixation,
  PageViewport,
  Page,
  Slice,
  SliceListItem,
  // Protocol
  ExtensionMessage,
  ServerMessage,
  DashboardMessage,
  DashboardPushMessage,
  SlicePayload,
  ApiResponse,
  SessionsQuery,
  SlicesQuery,
  HeatmapData,
  ReplayData,
  ElementAttention,
  ScreenshotInfo,
} from './types'

export { WS_CONFIG } from './types'

// Constants
export {
  CALIBRATION_POINTS,
  VALIDATION_POINTS,
  CALIBRATION_QUALITY,
  CALIBRATION_QUALITY_DEG,
  GAZE_CONFIDENCE_THRESHOLD,
  FIXATION_DISPERSION_THRESHOLD_PX,
  FIXATION_DISPERSION_THRESHOLD_DEG,
  FIXATION_DURATION_THRESHOLD_MS,
  FIXATION_MAX_GAP_MS,
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
  viewportOriginOnScreen,
  clientToScreen,
  screenToClient,
  captureWindowGeometry,
  normalizeGazeUrl,
  pxPerMmFromDiagonal,
  estimateViewingDistanceMm,
  pxPerDegree,
  degToPx,
  pxToDeg,
  derivePhysicalScreen,
  MM_PER_INCH,
  ASSUMED_IPD_MM,
  ASSUMED_WEBCAM_HFOV_DEG,
} from './utils'

export type { WindowGeometry, PhysicalScreenInfo } from './utils'
