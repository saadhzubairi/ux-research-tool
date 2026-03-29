import dotenv from 'dotenv'
dotenv.config()

export const config = {
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/gazekit',
  httpPort: parseInt(process.env.HTTP_PORT || '3000', 10),
  wsPort: parseInt(process.env.WS_PORT || '8765', 10),
  dataDir: process.env.DATA_DIR || './data',
  nodeEnv: process.env.NODE_ENV || 'development',
} as const
