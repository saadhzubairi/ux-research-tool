/**
 * Generate PNG icons matching the SVG sources in ../icons.
 *
 * Usage:  node scripts/generate-icons.mjs
 *
 * Renders the ismap mark — an indigo rounded square with a concentric
 * heatmap hotspot — as RGBA PNGs at 16/32/128px, with 4x supersampling
 * for antialiasing. No dependencies beyond Node's zlib.
 */

import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { deflateSync } from 'zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const iconsDir = resolve(__dirname, '..', 'icons')

const COLORS = {
  bg: [0x4f, 0x46, 0xe5],      // indigo-600
  ring: [0x81, 0x8c, 0xf8],    // indigo-400
  warm: [0xfb, 0xbf, 0x24],    // amber-400
  hot: [0xf9, 0x73, 0x16],     // orange-500
}

// Design in unit space (0..1): rounded rect inset ~3%, radius ~22%,
// hotspot circles at r 0.33 / 0.22 / 0.11 of icon size.
function sampleColor(u, v) {
  const inset = 0.03
  const radius = 0.22
  // rounded-rect test
  const x = Math.min(Math.max(u, inset + radius), 1 - inset - radius)
  const y = Math.min(Math.max(v, inset + radius), 1 - inset - radius)
  const d = Math.hypot(u - x, v - y)
  if (d > radius || u < inset || u > 1 - inset || v < inset || v > 1 - inset) return null

  const r = Math.hypot(u - 0.5, v - 0.5)
  if (r <= 0.11) return COLORS.hot
  if (r <= 0.22) return COLORS.warm
  if (r <= 0.33) return COLORS.ring
  return COLORS.bg
}

function renderPng(size) {
  const ss = 4 // supersampling factor
  const rowSize = 1 + size * 4
  const raw = Buffer.alloc(rowSize * size)

  for (let py = 0; py < size; py++) {
    const rowOffset = py * rowSize
    raw[rowOffset] = 0 // filter: None
    for (let px = 0; px < size; px++) {
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (px + (sx + 0.5) / ss) / size
          const v = (py + (sy + 0.5) / ss) / size
          const c = sampleColor(u, v)
          if (c) {
            rSum += c[0]; gSum += c[1]; bSum += c[2]; aSum += 255
          }
        }
      }
      const n = ss * ss
      const a = aSum / n
      const off = rowOffset + 1 + px * 4
      // premultiplied average, un-premultiplied for straight-alpha PNG
      const scale = a > 0 ? 255 / aSum : 0
      raw[off] = Math.round(rSum * scale)
      raw[off + 1] = Math.round(gSum * scale)
      raw[off + 2] = Math.round(bSum * scale)
      raw[off + 3] = Math.round(a)
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(size, 0)
  ihdrData.writeUInt32BE(size, 4)
  ihdrData[8] = 8  // bit depth
  ihdrData[9] = 6  // color type: RGBA
  const ihdr = createChunk('IHDR', ihdrData)
  const idat = createChunk('IDAT', deflateSync(raw))
  const iend = createChunk('IEND', Buffer.alloc(0))
  return Buffer.concat([signature, ihdr, idat, iend])
}

function createChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

for (const size of [16, 32, 128]) {
  const png = renderPng(size)
  const outPath = resolve(iconsDir, `icon${size}.png`)
  writeFileSync(outPath, png)
  console.log(`Created ${outPath} (${png.length} bytes)`)
}
