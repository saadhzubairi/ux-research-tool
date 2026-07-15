import { Schema, model } from 'mongoose'

const NINETY_DAYS_SECONDS = 90 * 24 * 60 * 60

// One capture tick. Replaces Screenshot and embeds gaze points (formerly the
// separate GazeEvent collection) — a slice's screenshot and its gaze points
// are always read together, so embedding avoids a per-read join.
//
// Stored as a MongoDB time-series collection: slices are append-only,
// time-ordered, and read back in time ranges. Because time-series collections
// don't support post-insert updates to measurement fields across all server
// versions, `fixations` are computed at ingest and written on the initial
// insert (never null in practice, never updated afterward) — see
// fixationService.computeSliceFixations / wsServer.handleSlice.
const SliceSchema = new Schema(
  {
    sessionId: { type: String, required: true },
    pageId: { type: Schema.Types.ObjectId, required: true },
    sliceIndex: { type: Number, required: true }, // 0-based order within the page
    capturedAt: { type: Date, required: true },
    trigger: { type: String, enum: ['interval', 'scroll', 'navigation'], required: true },
    screenshot: {
      filePath: String, // on-disk path, scheme sessionId/pageId/sliceIndex.png
      scrollX: Number,
      scrollY: Number,
      viewportWidth: Number,
      viewportHeight: Number,
    },
    gazePoints: [
      {
        _id: false,
        ts: Date,
        x: Number,
        y: Number,
        conf: Number,
        el: {
          sel: String,
          tag: String,
          txt: String,
          rect: { x: Number, y: Number, w: Number, h: Number },
        },
      },
    ],
    // Precomputed at ingest time (see fixationService). `el` is an internal
    // enrichment used by the /elements ranking route; it is projected out of
    // the client-facing SliceFixation shape.
    fixations: {
      type: [
        {
          _id: false,
          x: Number,
          y: Number,
          startTs: Date,
          durationMs: Number,
          el: {
            sel: String,
            tag: String,
            txt: String,
            rect: { x: Number, y: Number, w: Number, h: Number },
          },
        },
      ],
      default: null,
    },
  },
  {
    timeseries: {
      timeField: 'capturedAt',
      metaField: 'pageId',
      granularity: 'seconds',
    },
    expireAfterSeconds: NINETY_DAYS_SECONDS,
  }
)

// Timeline read + progressive-append ordering. (Not unique: time-series
// collections disallow unique indexes on measurement fields; sliceIndex
// uniqueness is guaranteed by the single-writer $inc on Page.sliceCount.)
SliceSchema.index({ sessionId: 1, pageId: 1, sliceIndex: 1 })
// Heatmap range queries.
SliceSchema.index({ pageId: 1, capturedAt: 1 })

export const Slice = model('Slice', SliceSchema)
