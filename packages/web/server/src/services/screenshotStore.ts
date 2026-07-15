import fs from 'fs/promises'
import path from 'path'
import { config } from '../config/env'

// Screenshot storage scheme for the Page/Slice rework:
//   {dataDir}/screenshots/{sessionId}/{pageId}/{sliceIndex}.png
// served at:
//   /api/screenshots/{sessionId}/{pageId}/{sliceIndex}.png
// Page/slice identity is now explicit, so no visit-folder inference is needed.

export function sliceScreenshotDir(sessionId: string, pageId: string): string {
  return path.join(config.dataDir, 'screenshots', sessionId, pageId)
}

export function sliceScreenshotPath(sessionId: string, pageId: string, sliceIndex: number): string {
  return path.join(sliceScreenshotDir(sessionId, pageId), `${sliceIndex}.png`)
}

export function sliceScreenshotUrl(sessionId: string, pageId: string, sliceIndex: number): string {
  return `/api/screenshots/${sessionId}/${pageId}/${sliceIndex}.png`
}

/** Map an on-disk slice screenshot filePath back to its served URL. */
export function filePathToUrl(filePath: string | null | undefined): string | null {
  if (!filePath) return null
  // .../screenshots/{sessionId}/{pageId}/{sliceIndex}.png → last 3 segments
  const parts = filePath.split(path.sep)
  const tail = parts.slice(-3)
  if (tail.length !== 3) return null
  return `/api/screenshots/${tail[0]}/${tail[1]}/${tail[2]}`
}

/** Decode a data URL and persist it to the slice's on-disk path. */
export async function writeSliceScreenshot(
  sessionId: string,
  pageId: string,
  sliceIndex: number,
  dataUrl: string
): Promise<string> {
  const match = dataUrl.match(/^data:image\/\w+;base64,(.+)$/)
  if (!match?.[1]) {
    throw new Error('Invalid data URL format')
  }
  const dir = sliceScreenshotDir(sessionId, pageId)
  await fs.mkdir(dir, { recursive: true })
  const filePath = sliceScreenshotPath(sessionId, pageId, sliceIndex)
  await fs.writeFile(filePath, Buffer.from(match[1], 'base64'))
  return filePath
}
