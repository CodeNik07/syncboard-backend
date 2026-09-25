import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import mongoose from 'mongoose'
import { createClient } from 'redis'
import { createAdapter } from '@socket.io/redis-adapter'
import boardRoutes from './routes/board.js'
import { setupSocket } from './socket/handler.js'
import { startCleanupWorker } from './jobs/cleanup.js'
import { YSocketIO } from 'y-socket.io/dist/server'
import { YjsDocument } from './models/index.js'
import * as Y from 'yjs'

export const app = express()
export const httpServer = createServer(app)

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST', 'DELETE'],
  },
})

// Middleware
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }))
app.use(express.json())

// Routes
app.use('/api/board', boardRoutes)

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    redis: REDIS_URL ? (redisReady ? 'connected' : 'disconnected') : 'not configured',
  })
})

// Socket.io
setupSocket(io)

// Redis adapter for horizontal scaling (optional — skipped if REDIS_URL is not set)
const REDIS_URL = process.env.REDIS_URL
let redisReady = false

async function setupRedisAdapter() {
  if (!REDIS_URL) {
    console.log('[SyncBoard] No REDIS_URL configured — running single-instance mode')
    return
  }

  try {
    const pubClient = createClient({ url: REDIS_URL })
    const subClient = pubClient.duplicate()

    pubClient.on('error', (err) => console.error('[Redis-pub]', err))
    subClient.on('error', (err) => console.error('[Redis-sub]', err))

    await Promise.all([pubClient.connect(), subClient.connect()])
    io.adapter(createAdapter(pubClient, subClient))
    redisReady = true
    console.log('[SyncBoard] Redis adapter connected — horizontal scaling enabled')
  } catch (err) {
    console.error('[SyncBoard] Failed to connect Redis adapter:', err)
    console.log('[SyncBoard] Falling back to single-instance mode')
  }
}

// Yjs Socket.io server integration
const ysocketio = new YSocketIO(io)
ysocketio.initialize()

ysocketio.on('document-loaded', async (doc: any) => {
  try {
    const record = await YjsDocument.findOne({ roomId: doc.name })
    if (record && record.document) {
      Y.applyUpdate(doc, record.document)
    }
  } catch (err) {
    console.error('[Yjs] Error loading document:', err)
  }
})

ysocketio.on('document-update', async (doc: any) => {
  try {
    const fullUpdate = Y.encodeStateAsUpdate(doc)
    await YjsDocument.findOneAndUpdate(
      { roomId: doc.name },
      { roomId: doc.name, document: Buffer.from(fullUpdate) },
      { upsert: true }
    )
  } catch (err) {
    console.error('[Yjs] Error saving document update:', err)
  }
})

// Connect to MongoDB and start server
const PORT = process.env.PORT || 3001
const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/collabryx'

if (process.env.NODE_ENV !== 'test') {
  mongoose.connect(MONGODB_URI)
    .then(async () => {
      console.log('[SyncBoard] Connected to MongoDB')
      await setupRedisAdapter()
      httpServer.listen(PORT, () => {
        console.log(`[SyncBoard] Server running on port ${PORT}`)
      })
      startCleanupWorker()
    })
    .catch((err) => {
      console.error('[SyncBoard] MongoDB connection error:', err)
      process.exit(1)
    })
}
