import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import { config } from './config/env'
import { connectDatabase } from './config/database'
import { createWsServer } from './ws/wsServer'
import { sessionsRouter } from './routes/sessions'
import { heatmapRouter } from './routes/heatmap'
import { screenshotsRouter } from './routes/screenshots'
import { statusRouter } from './routes/status'
import { errorHandler } from './middleware/errorHandler'
import { scheduleCleanup } from './services/cleanupService'

async function main() {
  await connectDatabase()

  const app = express()

  app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:4444'] }))
  app.use(express.json({ limit: '10mb' }))
  if (config.nodeEnv === 'development') app.use(morgan('dev'))

  app.use('/api/sessions', sessionsRouter)
  app.use('/api/heatmap', heatmapRouter)
  app.use('/api/screenshots', screenshotsRouter)
  app.use('/api', statusRouter)

  app.use(errorHandler)

  app.listen(config.httpPort, () => {
    console.log(`HTTP server on port ${config.httpPort}`)
  })

  createWsServer(config.wsPort)
  console.log(`WebSocket server on port ${config.wsPort}`)

  scheduleCleanup()
}

main().catch(console.error)
