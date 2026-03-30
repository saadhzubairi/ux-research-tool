import { Router } from 'express'
import path from 'path'
import fs from 'fs/promises'
import { config } from '../config/env'

export const screenshotsRouter = Router()

// GET /api/screenshots/:sessionId/:visitFolder/:filename — visit-folder path resolution
screenshotsRouter.get('/:sessionId/:visitFolder/:filename', async (req, res, next) => {
  try {
    const { sessionId, visitFolder, filename } = req.params

    if (!sessionId || !visitFolder || !filename
      || [sessionId, visitFolder, filename].some(p => p.includes('..') || p.includes('/') || p.includes('\\'))) {
      res.status(400).json({ success: false, error: 'Invalid parameters' })
      return
    }

    const filePath = path.join(config.dataDir, 'screenshots', sessionId, visitFolder, filename)

    try {
      await fs.access(filePath)
      res.sendFile(path.resolve(filePath))
    } catch {
      res.status(404).json({ success: false, error: 'Screenshot not found' })
    }
  } catch (err) {
    next(err)
  }
})

// GET /api/screenshots/:sessionId/:filename — direct path resolution (legacy)
screenshotsRouter.get('/:sessionId/:filename', async (req, res, next) => {
  try {
    const { sessionId, filename } = req.params

    if (!sessionId || !filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      res.status(400).json({ success: false, error: 'Invalid parameters' })
      return
    }

    const filePath = path.join(config.dataDir, 'screenshots', sessionId, filename)

    try {
      await fs.access(filePath)
      res.sendFile(path.resolve(filePath))
    } catch {
      res.status(404).json({ success: false, error: 'Screenshot not found' })
    }
  } catch (err) {
    next(err)
  }
})

// GET /api/screenshots/:filename — serve screenshot files (legacy)
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
