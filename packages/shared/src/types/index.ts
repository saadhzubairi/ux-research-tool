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
} from './gaze'

export type {
  ExtensionMessage,
  ServerMessage,
  DashboardMessage,
  DashboardPushMessage,
  SlicePayload,
} from './protocol'

export { WS_CONFIG } from './protocol'

export type {
  ApiResponse,
  SessionsQuery,
  SlicesQuery,
  HeatmapData,
  ReplayData,
  ElementAttention,
  ScreenshotInfo,
} from './api'
