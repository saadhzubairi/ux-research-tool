import { Session } from '../models/Session'
import { Screenshot } from '../models/Screenshot'
import fs from 'fs/promises'
import path from 'path'

const STALE_SESSION_HOURS = 4
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000

let cleanupTimer: ReturnType<typeof setInterval> | null = null

export function scheduleCleanup(): void {
  runCleanup().catch(err => console.error('Initial cleanup failed:', err))

  cleanupTimer = setInterval(() => {
    runCleanup().catch(err => console.error('Scheduled cleanup failed:', err))
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
    {
      status: 'active',
      updatedAt: { $lt: staleThreshold },
    },
    {
      $set: { status: 'error' },
    }
  )
  if (staleResult.modifiedCount > 0) {
    console.log(`Marked ${staleResult.modifiedCount} stale sessions as error`)
  }

  const allScreenshots = await Screenshot.find({}).lean()
  const sessionIds = new Set(
    (await Session.find({}).select('sessionId').lean()).map(s => s.sessionId)
  )

  let deletedCount = 0
  for (const screenshot of allScreenshots) {
    if (!sessionIds.has(screenshot.sessionId)) {
      if (screenshot.filePath) {
        try {
          await fs.unlink(screenshot.filePath)
        } catch {
          // File may already be deleted
        }
      }
      await Screenshot.deleteOne({ _id: screenshot._id })
      deletedCount++
    }
  }

  if (deletedCount > 0) {
    console.log(`Deleted ${deletedCount} orphaned screenshots`)
  }

  console.log('Cleanup complete')
}
