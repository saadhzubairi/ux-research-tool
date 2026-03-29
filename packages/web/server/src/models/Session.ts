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
    method: { type: String, enum: ['9-point', '13-point', '21-point', '9-point-dwell'] },
    avgErrorPx: Number,
    precisionPx: Number,
    qualityScore: Number,
    screenWidth: Number,
    screenHeight: Number,
    dpr: Number,
    calibratedAt: Date,
  },
  tracking: {
    library: String,
    version: String,
    regressionModel: String,
    avgFps: Number,
  },
  pages: [{
    url: String,
    enteredAt: Date,
    leftAt: Date,
  }],
  stats: {
    totalGazePoints: { type: Number, default: 0 },
    trackingLossSeconds: { type: Number, default: 0 },
    avgConfidence: { type: Number, default: 0 },
  },
  status: { type: String, enum: ['active', 'completed', 'error'], default: 'active' },
}, { timestamps: true })

export const Session = model('Session', SessionSchema)
