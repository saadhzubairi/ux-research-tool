export { WS_CONFIG } from './types/protocol'

// 13-point calibration grid. Corners/edges sit near the true screen edges
// (regression models extrapolate poorly outside the calibrated hull), with an
// inner ring for coverage of the central reading zone.
export const CALIBRATION_POINTS = [
  // Border sweep (clockwise from top-left)
  { x: 0.06, y: 0.08 },
  { x: 0.5, y: 0.08 },
  { x: 0.94, y: 0.08 },
  { x: 0.94, y: 0.5 },
  { x: 0.94, y: 0.92 },
  { x: 0.5, y: 0.92 },
  { x: 0.06, y: 0.92 },
  { x: 0.06, y: 0.5 },
  { x: 0.3, y: 0.28 },
  { x: 0.7, y: 0.28 },
  { x: 0.5, y: 0.5 },
  { x: 0.3, y: 0.72 },
  { x: 0.7, y: 0.72 },
]

// Validation covers the corners (where the model is weakest) plus center.
// None of these coincide with calibration points.
export const VALIDATION_POINTS = [
  { x: 0.12, y: 0.15 },
  { x: 0.88, y: 0.15 },
  { x: 0.5, y: 0.55 },
  { x: 0.12, y: 0.85 },
  { x: 0.88, y: 0.85 },
]

// Calibration quality gates, as a fraction of the viewport diagonal.
// On a 1920x1080 viewport (diagonal ~2203px): good < ~110px, usable < ~200px.
// Fallback for calibrations without physical screen info — when the user
// entered their screen size, CALIBRATION_QUALITY_DEG applies instead.
export const CALIBRATION_QUALITY = {
  GOOD_DIAG_FRACTION: 0.05,
  USABLE_DIAG_FRACTION: 0.09,
} as const

// Degree-based quality gates, used when the calibration captured physical
// screen info. Chosen to match the px gates at typical laptop geometry
// (~52 px/deg): webcam trackers bottom out around 1.5-2 deg, so < 2.2 deg is
// as good as the method gets.
export const CALIBRATION_QUALITY_DEG = {
  GOOD_MEDIAN_DEG: 2.2,
  USABLE_MEDIAN_DEG: 4.0,
} as const

// Drop threshold for gaze samples. Confidence is the product of head-rotation
// and distance-change penalties (each floored at 0.2), so 0.15 only drops
// samples where the head has BOTH turned far from the calibration pose and
// moved substantially closer/farther — moderate deviations keep their samples
// (with low conf attached) rather than silently vanishing from heatmaps.
export const GAZE_CONFIDENCE_THRESHOLD = 0.15
// I-DT dispersion gate. The px value is the fallback; when the session's
// calibration carries pxPerDeg, use the degree threshold instead (1 deg is
// the I-DT literature standard — 50px only matches it at laptop geometry).
export const FIXATION_DISPERSION_THRESHOLD_PX = 50
export const FIXATION_DISPERSION_THRESHOLD_DEG = 1.0
export const FIXATION_DURATION_THRESHOLD_MS = 100
// Break fixation windows across sample gaps (tracking loss, blinks, tab
// switches) so a gap-bridging "fixation" can't span seconds and wash out
// heatmap normalization.
export const FIXATION_MAX_GAP_MS = 250
export const HEATMAP_BLUR_RADIUS = 80
export const MAX_SELECTOR_DEPTH = 8
