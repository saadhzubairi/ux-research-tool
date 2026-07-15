/** Single gaze sample from the eye-tracking pipeline */
export interface GazeSample {
  x: number
  y: number
  ts: number
  conf: number | null
}

export interface GazeElement {
  selector: string
  tag: string
  text: string
  rect: { x: number; y: number; w: number; h: number }
}

export interface GazeEvent {
  sample: GazeSample
  element: GazeElement | null
  context: GazeContext
}

export interface GazeContext {
  url: string
  scrollX: number
  scrollY: number
  viewportWidth: number
  viewportHeight: number
  docWidth: number
  docHeight: number
  domVersion: number
  dpr: number
}

export interface GazeBatch {
  type: 'gaze_batch'
  sessionId: string
  events: GazeEvent[]
  batchIndex: number
}

export interface CalibrationResult {
  method: '9-point' | '13-point' | '21-point' | '9-point-dwell' | '6-point-polynomial' | '13-point-ridge'
  avgErrorPx: number
  precisionPx: number
  qualityScore: number
  screenWidth: number
  screenHeight: number
  dpr: number
  calibratedAt: string
  // Physical-screen context (null/absent when the user skipped the
  // screen-size input). pxPerDeg lets consumers express thresholds and
  // errors in visual degrees instead of resolution-dependent px.
  screenDiagonalMm?: number | null
  viewingDistanceMm?: number | null
  pxPerDeg?: number | null
  avgErrorDeg?: number | null
}

export interface SessionMeta {
  sessionId: string
  userId: string
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  // Authoritative liveness signal (a crashed session is swept to 'error'
  // with endedAt still null, so prefer this over endedAt === null).
  status: 'active' | 'completed' | 'error'
  // Read-path schema marker: v1 = legacy Screenshot/GazeEvent, v2 = Page/Slice.
  schemaVersion?: number
  device: {
    userAgent: string
    screenWidth: number
    screenHeight: number
    dpr: number
  }
  webcam: {
    label: string
    resolution: { w: number; h: number }
  }
  calibration: CalibrationResult
  tracking: {
    library: 'webgazer' | 'mediapipe'
    version: string
    regressionModel: 'ridge' | 'polynomial'
    avgFps: number
  }
  pages: Array<{
    url: string
    enteredAt: string
    leftAt: string | null
  }>
  stats: {
    totalGazePoints: number
    trackingLossSeconds: number
    avgConfidence: number
  }
}

export interface Fixation {
  x: number
  y: number
  startTs: number
  endTs: number
  durationMs: number
  sampleCount: number
  element: GazeElement | null
  url: string
  scrollY: number
}

export interface HeatmapPoint {
  nx: number
  ny: number
  value: number
}

// ---------------------------------------------------------------------------
// Page / Slice model (slice-capture rework)
// ---------------------------------------------------------------------------

/** Why a slice was captured. Drives page-boundary + cadence logic. */
export type SliceTrigger = 'interval' | 'scroll' | 'navigation'

/**
 * A single gaze point as carried on the wire inside a `slice` message —
 * today's `GazeEvent` minus the per-point `context` (now hoisted to the
 * slice envelope, since it's constant across a slice's capture window).
 */
export interface GazePoint {
  sample: GazeSample
  element: GazeElement | null
}

/** Element a gaze point landed on, as stored/served for a slice. */
export interface SliceGazeElement {
  sel: string
  tag: string
  txt: string
  rect: { x: number; y: number; w: number; h: number }
}

/** A gaze point as stored on / served from a `Slice` document. */
export interface SliceGazePoint {
  ts: string
  x: number
  y: number
  conf: number
  el: SliceGazeElement | null
}

/** Screenshot metadata bundled with a slice (client-facing). */
export interface SliceScreenshot {
  /**
   * Served URL for the PNG. The server maps the Mongo `screenshot.filePath`
   * (on-disk path, scheme `sessionId/pageId/sliceIndex.png`) to this URL.
   */
  url: string
  scrollX: number
  scrollY: number
  viewportWidth: number
  viewportHeight: number
}

/** A fixation precomputed at slice-close time and embedded in the slice. */
export interface SliceFixation {
  x: number
  y: number
  startTs: string
  durationMs: number
}

/** Viewport captured at page entry, for slice coordinate context. */
export interface PageViewport {
  width: number
  height: number
  dpr: number
}

/**
 * One URL-visit within a session (client-facing mirror of the Mongo `Page`
 * schema; `Date`s are ISO strings over the wire). Revisiting a URL later in
 * the same session produces a new `Page`.
 */
export interface Page {
  _id: string
  sessionId: string
  pageIndex: number
  url: string
  enteredAt: string
  leftAt: string | null
  sliceCount: number
  viewport: PageViewport
  status: 'active' | 'complete'
}

/**
 * One capture tick (client-facing mirror of the Mongo `Slice` schema).
 * Bundles the screenshot with the gaze points captured in the same window,
 * plus precomputed fixations (`null` until computed at ingest time).
 */
export interface Slice {
  _id: string
  sessionId: string
  pageId: string
  sliceIndex: number
  capturedAt: string
  trigger: SliceTrigger
  screenshot: SliceScreenshot
  gazePoints: SliceGazePoint[]
  fixations: SliceFixation[] | null
}

/**
 * Lighter slice shape returned by the slice-list endpoint and pushed over
 * the live channel: raw `gazePoints` omitted (heavy, rarely needed raw on
 * the client — request `?includePoints=true` for the full `Slice`).
 *
 * Identity fields (`_id`, `sessionId`, `pageId`) are OPTIONAL here: the list
 * endpoint scopes them via the request path and the live push carries
 * `sessionId`/`pageId` on its envelope, so a lean payload may omit them. They
 * remain present on the full `Slice`.
 */
export interface SliceListItem {
  _id?: string
  sessionId?: string
  pageId?: string
  sliceIndex: number
  capturedAt: string
  trigger: SliceTrigger
  screenshot: SliceScreenshot
  fixations: SliceFixation[] | null
}
