import { Router } from 'express'
import mongoose from 'mongoose'
import type { ApiResponse } from '@gazekit/shared'
import { getActiveConnectionCount } from '../ws/wsServer'

export const statusRouter = Router()

const startTime = Date.now()

interface StatusData {
  status: 'healthy' | 'degraded' | 'unhealthy'
  mongo: {
    connected: boolean
    state: string
  }
  websocket: {
    activeConnections: number
  }
  uptime: {
    seconds: number
    formatted: string
  }
  timestamp: string
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  parts.push(`${secs}s`)

  return parts.join(' ')
}

// GET /api/status — health check
statusRouter.get('/status', (_req, res) => {
  const mongoState = mongoose.connection.readyState
  const mongoStates: Record<number, string> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  }

  const isMongoConnected = mongoState === 1
  const uptimeSeconds = (Date.now() - startTime) / 1000

  const statusData: StatusData = {
    status: isMongoConnected ? 'healthy' : 'degraded',
    mongo: {
      connected: isMongoConnected,
      state: mongoStates[mongoState] ?? 'unknown',
    },
    websocket: {
      activeConnections: getActiveConnectionCount(),
    },
    uptime: {
      seconds: Math.floor(uptimeSeconds),
      formatted: formatUptime(uptimeSeconds),
    },
    timestamp: new Date().toISOString(),
  }

  const response: ApiResponse<StatusData> = {
    success: true,
    data: statusData,
  }

  const httpStatus = isMongoConnected ? 200 : 503
  res.status(httpStatus).json(response)
})
