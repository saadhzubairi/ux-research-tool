import { Schema, model } from 'mongoose'

const RrwebEventSchema = new Schema({
  sessionId: { type: String, required: true, index: true },
  events: Schema.Types.Mixed,
  batchIndex: Number,
  receivedAt: { type: Date, default: Date.now },
}, { timestamps: true })

export const RrwebEvent = model('RrwebEvent', RrwebEventSchema)
