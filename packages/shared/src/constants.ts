export { WS_CONFIG } from './types/protocol'

export const CALIBRATION_POINTS = [
  // Top row (3 points)
  { x: 0.2, y: 0.2 },
  { x: 0.5, y: 0.2 },
  { x: 0.8, y: 0.2 },
  // Center
  { x: 0.5, y: 0.5 },
  // Bottom corners (2 points)
  { x: 0.2, y: 0.8 },
  { x: 0.8, y: 0.8 },
]

export const VALIDATION_POINTS = [
  { x: 0.35, y: 0.35 },
  { x: 0.65, y: 0.65 },
  { x: 0.50, y: 0.75 },
]

export const GAZE_CONFIDENCE_THRESHOLD = 0.4
export const FIXATION_DISPERSION_THRESHOLD_PX = 50
export const FIXATION_DURATION_THRESHOLD_MS = 100
export const HEATMAP_BLUR_RADIUS = 50
export const MAX_SELECTOR_DEPTH = 8
