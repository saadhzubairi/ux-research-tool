import mongoose from 'mongoose'
import { config } from './env'

export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(config.mongoUri)
    console.log('Connected to MongoDB')
    await runMigrations()
  } catch (err) {
    console.error('MongoDB connection error:', err)
    process.exit(1)
  }
}

async function runMigrations(): Promise<void> {
  const db = mongoose.connection.db
  if (!db) {
    throw new Error('Database connection not established')
  }

  const collections = await db.listCollections({ name: 'gazeevents' }).toArray()

  if (collections.length === 0) {
    console.log('Creating time series collection: gazeevents')
    try {
      await db.createCollection('gazeevents', {
        timeseries: {
          timeField: 'ts',
          metaField: 'meta',
          granularity: 'seconds',
        },
        expireAfterSeconds: 86400 * 90,
      })
      console.log('Time series collection created')
    } catch (err) {
      // Mongoose's autoCreate for the GazeEvent model can create the
      // collection between the check above and this call (NamespaceExists).
      if ((err as { code?: number }).code !== 48) throw err
      console.log('gazeevents already created by model init')
    }
  }

  const gazeEventsCollection = db.collection('gazeevents')

  await gazeEventsCollection.createIndex(
    { 'meta.sid': 1, ts: 1 },
    { background: true }
  )
  await gazeEventsCollection.createIndex(
    { 'ctx.url': 1 },
    { background: true }
  )
  await gazeEventsCollection.createIndex(
    { 'meta.uid': 1 },
    { background: true }
  )

  console.log('Database indexes ensured')
}
