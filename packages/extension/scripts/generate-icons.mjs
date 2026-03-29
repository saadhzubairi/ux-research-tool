/**
 * Generate placeholder PNG icons from SVG sources.
 *
 * Usage:  node scripts/generate-icons.mjs
 *
 * For production, replace these with properly designed assets.
 * This script creates minimal 1-color PNGs so the extension loads
 * without errors during development.
 */

import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const iconsDir = resolve(__dirname, '..', 'icons')

// Minimal valid PNG: 1x1 blue pixel, then scaled via canvas in the browser.
// These are just enough to satisfy Chrome's icon requirements during dev.
// Generated with: a valid PNG header + IHDR + IDAT + IEND for a solid blue square.

function createMinimalPng(size) {
  // We create a very simple uncompressed PNG with a single color.
  // For development placeholders this is sufficient.

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  // IHDR chunk
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(size, 0)   // width
  ihdrData.writeUInt32BE(size, 4)   // height
  ihdrData[8] = 8                    // bit depth
  ihdrData[9] = 2                    // color type: RGB
  ihdrData[10] = 0                   // compression
  ihdrData[11] = 0                   // filter
  ihdrData[12] = 0                   // interlace

  const ihdr = createChunk('IHDR', ihdrData)

  // IDAT chunk — raw image data (uncompressed deflate)
  // Each row: filter byte (0) + RGB pixels
  const rowSize = 1 + size * 3
  const rawData = Buffer.alloc(rowSize * size)

  for (let y = 0; y < size; y++) {
    const rowOffset = y * rowSize
    rawData[rowOffset] = 0 // filter: None
    for (let x = 0; x < size; x++) {
      const px = rowOffset + 1 + x * 3
      rawData[px] = 37      // R (blue: #2563eb)
      rawData[px + 1] = 99  // G
      rawData[px + 2] = 235 // B
    }
  }

  // Wrap in zlib (deflate with zlib header)
  const zlibData = deflateRaw(rawData)
  const idat = createChunk('IDAT', zlibData)

  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([signature, ihdr, idat, iend])
}

function createChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)

  const typeBuffer = Buffer.from(type, 'ascii')
  const crcInput = Buffer.concat([typeBuffer, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(crcInput), 0)

  return Buffer.concat([length, typeBuffer, data, crc])
}

// Simple deflate: store blocks (no compression) with zlib wrapper
function deflateRaw(data) {
  // Zlib header: CMF=0x78 (deflate, window 32k), FLG=0x01 (no dict, check bits)
  const header = Buffer.from([0x78, 0x01])

  // Split into 65535-byte store blocks
  const blocks = []
  let offset = 0
  while (offset < data.length) {
    const remaining = data.length - offset
    const blockSize = Math.min(remaining, 65535)
    const isLast = offset + blockSize >= data.length

    const blockHeader = Buffer.alloc(5)
    blockHeader[0] = isLast ? 0x01 : 0x00
    blockHeader.writeUInt16LE(blockSize, 1)
    blockHeader.writeUInt16LE(blockSize ^ 0xffff, 3)

    blocks.push(blockHeader)
    blocks.push(data.subarray(offset, offset + blockSize))
    offset += blockSize
  }

  // Adler-32 checksum
  const adler = adler32(data)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(adler, 0)

  return Buffer.concat([header, ...blocks, checksum])
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

function adler32(buf) {
  let a = 1
  let b = 0
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

// Generate icons
for (const size of [16, 32, 128]) {
  const png = createMinimalPng(size)
  const outPath = resolve(iconsDir, `icon${size}.png`)
  writeFileSync(outPath, png)
  console.log(`Created ${outPath} (${png.length} bytes)`)
}
