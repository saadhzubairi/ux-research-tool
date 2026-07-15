// ---------------------------------------------------------------------------
// Visual-angle geometry.
//
// Gaze accuracy is fundamentally angular (webcam trackers bottom out around
// 1.5–2°), so a pixel threshold means a different thing on a 13" laptop than
// on a 27" monitor. Converting px <-> degrees needs two physical quantities
// the browser cannot provide:
//   - the screen's physical size — entered once by the user (diagonal inches)
//   - the viewing distance — estimated from the inter-ocular distance in the
//     camera frame, assuming a population-average IPD and a typical webcam FOV
// Both are estimates (±10–20%); derived thresholds are calibrated defaults,
// not exact optics, and every consumer must keep a px fallback for setups
// where the user skipped the screen-size input.
// ---------------------------------------------------------------------------

export const MM_PER_INCH = 25.4

/** Population-average adult inter-pupillary distance. */
export const ASSUMED_IPD_MM = 63

/** Typical built-in webcam horizontal field of view. */
export const ASSUMED_WEBCAM_HFOV_DEG = 60

// An estimated viewing distance outside this band is more likely IPD/FOV
// assumption error than a real posture — clamp rather than propagate a wild
// distance into every derived threshold.
const MIN_VIEWING_DISTANCE_MM = 300
const MAX_VIEWING_DISTANCE_MM = 1200

/** Physical screen geometry captured at calibration time. */
export interface PhysicalScreenInfo {
  /** User-entered physical diagonal, mm */
  screenDiagonalMm: number
  /** Device-independent screen px per mm */
  pxPerMm: number
  /** Estimated eye-to-screen distance at calibration, mm */
  viewingDistanceMm: number
  /** Screen px spanned by 1° of visual angle at that distance */
  pxPerDeg: number
}

/** Screen px per mm from the user-entered diagonal. Null on invalid input. */
export function pxPerMmFromDiagonal(
  screenWidthPx: number,
  screenHeightPx: number,
  diagonalInches: number,
): number | null {
  if (
    !Number.isFinite(screenWidthPx) || screenWidthPx <= 0 ||
    !Number.isFinite(screenHeightPx) || screenHeightPx <= 0 ||
    !Number.isFinite(diagonalInches) || diagonalInches <= 0
  ) {
    return null
  }
  return Math.hypot(screenWidthPx, screenHeightPx) / (diagonalInches * MM_PER_INCH)
}

/**
 * Estimate eye-to-camera distance from the inter-ocular distance measured in
 * the camera frame (as a fraction of frame width — MediaPipe normalized
 * units). Pinhole model: distance = IPD * f / interocular, with the focal
 * length derived from an assumed horizontal FOV. Clamped to a plausible
 * desk-use band. Null on invalid input.
 */
export function estimateViewingDistanceMm(
  interocularNorm: number,
  hfovDeg: number = ASSUMED_WEBCAM_HFOV_DEG,
): number | null {
  if (
    !Number.isFinite(interocularNorm) || interocularNorm <= 0 || interocularNorm >= 1 ||
    !Number.isFinite(hfovDeg) || hfovDeg <= 0 || hfovDeg >= 180
  ) {
    return null
  }
  // Focal length in units of frame width
  const focalNorm = 0.5 / Math.tan((hfovDeg * Math.PI) / 360)
  const distance = (ASSUMED_IPD_MM * focalNorm) / interocularNorm
  return Math.min(MAX_VIEWING_DISTANCE_MM, Math.max(MIN_VIEWING_DISTANCE_MM, distance))
}

/** Screen px spanned by 1° of visual angle. */
export function pxPerDegree(viewingDistanceMm: number, pxPerMm: number): number {
  return viewingDistanceMm * Math.tan(Math.PI / 180) * pxPerMm
}

export function degToPx(deg: number, pxPerDeg: number): number {
  return deg * pxPerDeg
}

export function pxToDeg(px: number, pxPerDeg: number): number {
  return px / pxPerDeg
}

/**
 * Bundle the full physical-screen context, or null when any input is missing
 * or degenerate — callers treat null as "stay in px space".
 */
export function derivePhysicalScreen(
  screenWidthPx: number,
  screenHeightPx: number,
  diagonalInches: number,
  interocularNorm: number,
  hfovDeg: number = ASSUMED_WEBCAM_HFOV_DEG,
): PhysicalScreenInfo | null {
  const pxPerMm = pxPerMmFromDiagonal(screenWidthPx, screenHeightPx, diagonalInches)
  const viewingDistanceMm = estimateViewingDistanceMm(interocularNorm, hfovDeg)
  if (pxPerMm === null || viewingDistanceMm === null) return null

  const pxPerDeg = pxPerDegree(viewingDistanceMm, pxPerMm)
  if (!Number.isFinite(pxPerDeg) || pxPerDeg <= 0) return null

  return {
    screenDiagonalMm: diagonalInches * MM_PER_INCH,
    pxPerMm,
    viewingDistanceMm,
    pxPerDeg,
  }
}
