import { Session } from '../models/Session'
import { Screenshot } from '../models/Screenshot'
import { Slice } from '../models/Slice'
import { config } from '../config/env'
import fs from 'fs/promises'
import path from 'path'

const STALE_SESSION_HOURS = 4
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000

let cleanupTimer: ReturnType<typeof setInterval> | null = null

export function scheduleCleanup(): void {
  runCleanup().catch((err) => console.error('Initial cleanup failed:', err))

  cleanupTimer = setInterval(() => {
    runCleanup().catch((err) => console.error('Scheduled cleanup failed:', err))
  }, CLEANUP_INTERVAL_MS)

  console.log('Cleanup service scheduled (every 24h)')
}

export function stopCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
}

async function runCleanup(): Promise<void> {
  console.log('Running cleanup...')

  const staleThreshold = new Date(Date.now() - STALE_SESSION_HOURS * 60 * 60 * 1000)
  const staleResult = await Session.updateMany(
    { status: 'active', updatedAt: { $lt: staleThreshold } },
    { $set: { status: 'error' } }
  )
  if (staleResult.modifiedCount > 0) {
    console.log(`Marked ${staleResult.modifiedCount} stale sessions as error`)
  }

  await cleanupLegacyOrphanScreenshots()
  await cleanupExpiredSliceScreenshots()

  console.log('Cleanup complete')
}

// v1: delete Screenshot docs (and their files) for sessions that no longer exist.
async function cleanupLegacyOrphanScreenshots(): Promise<void> {
  const allScreenshots = await Screenshot.find({}).lean()
  const sessionIds = new Set(
    (await Session.find({}).select('sessionId').lean()).map((s) => s.sessionId)
  )

  let deletedCount = 0
  for (const screenshot of allScreenshots) {
    if (!sessionIds.has(screenshot.sessionId)) {
      if (screenshot.filePath) {
        await fs.unlink(screenshot.filePath).catch(() => {})
      }
      await Screenshot.deleteOne({ _id: screenshot._id })
      deletedCount++
    }
  }
  if (deletedCount > 0) {
    console.log(`Deleted ${deletedCount} orphaned legacy screenshots`)
  }
}

/**
 * v2: reconcile on-disk slice PNGs with the Slice collection. Mongo's 90-day
 * TTL deletes expired Slice docs but not their referenced PNGs, so any file
 * under screenshots/{sessionId}/{pageId}/ whose Slice doc is gone is a leaked
 * file to unlink. Directories for fully-deleted sessions are removed wholesale.
 */
async function cleanupExpiredSliceScreenshots(): Promise<void> {
  const baseDir = path.join(config.dataDir, 'screenshots')
  let sessionDirs: string[]
  try {
    sessionDirs = await fs.readdir(baseDir)
  } catch {
    return // no screenshots dir yet
  }

  const liveSessionIds = new Set(
    (await Session.find({}).select('sessionId').lean()).map((s) => s.sessionId)
  )

  let unlinked = 0
  for (const sessionId of sessionDirs) {
    const sessionPath = path.join(baseDir, sessionId)
    const stat = await fs.stat(sessionPath).catch(() => null)
    if (!stat?.isDirectory()) continue

    // Session gone entirely → remove its whole screenshot tree.
    if (!liveSessionIds.has(sessionId)) {
      await fs.rm(sessionPath, { recursive: true, force: true }).catch(() => {})
      continue
    }

    // Only v2 sessions use the pageId/sliceIndex.png layout.
    const pageDirs = await fs.readdir(sessionPath).catch(() => [])
    for (const pageId of pageDirs) {
      const pagePath = path.join(sessionPath, pageId)
      const pStat = await fs.stat(pagePath).catch(() => null)
      if (!pStat?.isDirectory()) continue

      // Slice indexes still backed by a (non-expired) doc for this page.
      const liveIndexes = new Set(
        (await Slice.find({ pageId }).select({ sliceIndex: 1 }).lean()).map(
          (s) => s.sliceIndex
        )
      )

      const files = await fs.readdir(pagePath).catch(() => [])
      for (const file of files) {
        const idx = Number.parseInt(file.replace(/\.png$/, ''), 10)
        if (Number.isNaN(idx)) continue
        if (!liveIndexes.has(idx)) {
          await fs.unlink(path.join(pagePath, file)).catch(() => {})
          unlinked++
        }
      }
    }
  }

  if (unlinked > 0) {
    console.log(`Deleted ${unlinked} expired slice screenshot files (TTL orphans)`)
  }
}
