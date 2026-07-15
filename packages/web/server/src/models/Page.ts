import { Schema, model } from 'mongoose'

// One URL-visit within a session (NOT one doc per unique URL — revisiting a
// URL later in the same session creates a new Page). Replaces the old
// embedded Session.pages[] array as the queryable source of truth.
const PageSchema = new Schema({
  sessionId: { type: String, required: true, index: true },
  pageIndex: { type: Number, required: true }, // 0-based order within the session
  url: { type: String, required: true }, // normalized via normalizeGazeUrl
  enteredAt: { type: Date, required: true },
  leftAt: { type: Date, default: null }, // set when the next Page opens or session ends
  sliceCount: { type: Number, default: 0 }, // denormalized — avoids a COUNT for the timeline UI
  viewport: {
    width: Number,
    height: Number,
    dpr: Number,
  },
  status: { type: String, enum: ['active', 'complete'], default: 'active' },
})

// Timeline ordering + uniqueness of a page slot within a session.
PageSchema.index({ sessionId: 1, pageIndex: 1 }, { unique: true })
// URL tab grouping — replaces the old Session.pages.url filter.
PageSchema.index({ sessionId: 1, url: 1 })

export const Page = model('Page', PageSchema)
