/** Single gaze sample from WebGazer */
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
  method: '9-point' | '13-point' | '21-point' | '9-point-dwell'
  avgErrorPx: number
  precisionPx: number
  qualityScore: number
  screenWidth: number
  screenHeight: number
  dpr: number
  calibratedAt: string
}

export interface SessionMeta {
  sessionId: string
  userId: string
  startedAt: string
  endedAt: string | null
  durationMs: number | null
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
    library: 'webgazer'
    version: string
    regressionModel: 'ridge'
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
