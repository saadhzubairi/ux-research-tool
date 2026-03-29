export { WS_CONFIG } from './types/protocol'

export const CALIBRATION_POINTS_9 = [
  { x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.9, y: 0.1 },
  { x: 0.1, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 },
  { x: 0.1, y: 0.9 }, { x: 0.5, y: 0.9 }, { x: 0.9, y: 0.9 },
] as const

export const CALIBRATION_POINTS_13 = [
  ...CALIBRATION_POINTS_9,
  { x: 0.3, y: 0.3 }, { x: 0.7, y: 0.3 },
  { x: 0.3, y: 0.7 }, { x: 0.7, y: 0.7 },
] as const

export const GAZE_CONFIDENCE_THRESHOLD = 0.4
export const FIXATION_DISPERSION_THRESHOLD_PX = 50
export const FIXATION_DURATION_THRESHOLD_MS = 100
export const HEATMAP_BLUR_RADIUS = 50
export const MAX_SELECTOR_DEPTH = 8
