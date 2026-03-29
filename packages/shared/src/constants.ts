export { WS_CONFIG } from './types/protocol'

// Corners + diamond + center — 9 well-spaced points
// Corners anchor the extremes, diamond fills the interior, center ties it together
export const CALIBRATION_POINTS = [
  // 4 corners
  { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 },
  { x: 0.1, y: 0.9 }, { x: 0.9, y: 0.9 },
  // 4 diamond points
  { x: 0.5, y: 0.2 },
  { x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 },
  { x: 0.5, y: 0.8 },
  // center
  { x: 0.5, y: 0.5 },
] as const

export const GAZE_CONFIDENCE_THRESHOLD = 0.4
export const FIXATION_DISPERSION_THRESHOLD_PX = 50
export const FIXATION_DURATION_THRESHOLD_MS = 100
export const HEATMAP_BLUR_RADIUS = 50
export const MAX_SELECTOR_DEPTH = 8
