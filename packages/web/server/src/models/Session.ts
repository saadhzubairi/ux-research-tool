import { Schema, model } from 'mongoose'

const SessionSchema = new Schema({
  sessionId: { type: String, required: true, unique: true, index: true },
  userId: { type: String, default: 'anonymous', index: true },
  startedAt: { type: Date, required: true },
  endedAt: Date,
  durationMs: Number,
  device: {
    userAgent: String,
    screenWidth: Number,
    screenHeight: Number,
    dpr: Number,
  },
  webcam: {
    label: String,
    resolution: { w: Number, h: Number },
  },
  calibration: {
    // Keep in sync with CalibrationResult['method'] in @gazekit/shared
    method: { type: String, enum: ['9-point', '13-point', '21-point', '9-point-dwell', '6-point-polynomial', '13-point-ridge', 'pursuit-ridge'] },
    avgErrorPx: Number,
    precisionPx: Number,
    qualityScore: Number,
    screenWidth: Number,
    screenHeight: Number,
    dpr: Number,
    calibratedAt: Date,
    // Physical-screen context (null when the user skipped the screen-size
    // input). pxPerDeg drives visual-degree thresholds, e.g. fixation
    // dispersion in fixationService.
    screenDiagonalMm: Number,
    viewingDistanceMm: Number,
    pxPerDeg: Number,
    avgErrorDeg: Number,
  },
  tracking: {
    library: String,
    version: String,
    regressionModel: String,
    avgFps: Number,
  },
  // Page/Slice rework: pages are now first-class `Page` documents keyed by
  // sessionId, not an embedded array. schemaVersion gates the read path —
  // v1 sessions still carry legacy Screenshot/GazeEvent docs (and, in old
  // rows, an embedded pages[]); v2 sessions use Page/Slice. Old v1 data ages
  // out via the 90-day slice TTL, so no backfill is written.
  schemaVersion: { type: Number, default: 1 },
  stats: {
    totalGazePoints: { type: Number, default: 0 },
    trackingLossSeconds: { type: Number, default: 0 },
    avgConfidence: { type: Number, default: 0 },
    // Running accumulators so avgConfidence is a true session-wide mean
    confSum: { type: Number, default: 0 },
    confCount: { type: Number, default: 0 },
  },
  status: { type: String, enum: ['active', 'completed', 'error'], default: 'active' },
}, { timestamps: true })

export const Session = model('Session', SessionSchema)
