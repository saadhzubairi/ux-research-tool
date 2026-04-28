export { WS_CONFIG } from './types/protocol'

export const CALIBRATION_POINTS = [
  // Top row
  { x: 0.15, y: 0.15 },
  { x: 0.5, y: 0.15 },
  { x: 0.85, y: 0.15 },
  // Middle row
  { x: 0.15, y: 0.5 },
  { x: 0.5, y: 0.5 },
  { x: 0.85, y: 0.5 },
  // Bottom row
  { x: 0.15, y: 0.85 },
  { x: 0.5, y: 0.85 },
  { x: 0.85, y: 0.85 },
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
