export {
  viewportToDocument,
  viewportToNormalized,
  normalizedToViewport,
} from './coordinateNormalizer'

export { detectFixations } from './fixationDetector'

export {
  viewportOriginOnScreen,
  clientToScreen,
  screenToClient,
  captureWindowGeometry,
  type WindowGeometry,
} from './screenCoords'

export { generateSelector } from './selectorGenerator'

export { normalizeGazeUrl } from './urlNormalizer'

export {
  pxPerMmFromDiagonal,
  estimateViewingDistanceMm,
  pxPerDegree,
  degToPx,
  pxToDeg,
  derivePhysicalScreen,
  MM_PER_INCH,
  ASSUMED_IPD_MM,
  ASSUMED_WEBCAM_HFOV_DEG,
  type PhysicalScreenInfo,
} from './visualAngle'
