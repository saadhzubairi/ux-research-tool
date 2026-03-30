import { Schema, model } from 'mongoose'

const ScreenshotSchema = new Schema({
  sessionId: { type: String, required: true, index: true },
  url: String,
  scrollY: Number,
  viewportHeight: Number,
  filePath: String,
  filename: String,
  index: Number,
  visitIndex: Number,
  visitFolder: String,
  capturedAt: { type: Date, required: true },
})

ScreenshotSchema.index({ sessionId: 1, url: 1, visitIndex: 1, capturedAt: 1 })

export const Screenshot = model('Screenshot', ScreenshotSchema)
