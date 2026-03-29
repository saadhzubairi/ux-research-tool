import { Schema, model } from 'mongoose'

const GazeEventSchema = new Schema({
  ts: { type: Date, required: true },
  x: Number,
  y: Number,
  conf: Number,
  el: {
    sel: String,
    tag: String,
    txt: String,
    rect: { x: Number, y: Number, w: Number, h: Number },
  },
  ctx: {
    url: String,
    sx: Number,
    sy: Number,
    vw: Number,
    vh: Number,
    dw: Number,
    dh: Number,
    dv: Number,
    dpr: Number,
  },
  meta: {
    sid: { type: String, required: true },
    uid: String,
    bi: Number,
  },
}, { timestamps: false })

export const GazeEvent = model('GazeEvent', GazeEventSchema, 'gazeevents')
