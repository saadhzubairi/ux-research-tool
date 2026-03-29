import { Schema, model } from 'mongoose'

const ScreenshotSchema = new Schema({
  sessionId: { type: String, required: true, index: true },
  url: String,
  scrollY: Number,
  viewportHeight: Number,
  filePath: String,
  capturedAt: { type: Date, required: true },
})

export const Screenshot = model('Screenshot', ScreenshotSchema)
