import { Router } from 'express'
import path from 'path'
import fs from 'fs/promises'
import { config } from '../config/env'

export const screenshotsRouter = Router()

// GET /api/screenshots/:filename — serve screenshot files
screenshotsRouter.get('/:filename', async (req, res, next) => {
  try {
    const filename = req.params.filename

    // Prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      res.status(400).json({
        success: false,
        error: 'Invalid filename',
      })
      return
    }

    // Search for the file in all session screenshot directories
    const screenshotsBaseDir = path.join(config.dataDir, 'screenshots')

    let filePath: string | null = null

    try {
      const sessionDirs = await fs.readdir(screenshotsBaseDir)
      for (const sessionDir of sessionDirs) {
        const candidatePath = path.join(screenshotsBaseDir, sessionDir, filename)
        try {
          await fs.access(candidatePath)
          filePath = candidatePath
          break
        } catch {
          // File not in this directory, continue searching
        }
      }
    } catch {
      // Screenshots directory doesn't exist
    }

    if (!filePath) {
      res.status(404).json({
        success: false,
        error: 'Screenshot not found',
      })
      return
    }

    res.sendFile(path.resolve(filePath))
  } catch (err) {
    next(err)
  }
})
