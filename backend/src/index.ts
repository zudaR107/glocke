import { serve } from '@hono/node-server'
import { createId } from '@paralleldrive/cuid2'
import {
  createAuthMiddleware,
  createCorsMiddleware,
  createExportAuthMiddleware,
} from '@zudar107/schloss-server-kit'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { logger } from 'hono/logger'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { db, sqlite } from './db/index.js'
import { users } from './db/schema.js'
import { createProcessor } from './processor.js'
import { SqliteNotificationRepository } from './repository.js'
import { createSchlusselRecipientResolver } from './schlussel.js'
import { loadConfig } from './config.js'

const config = loadConfig()
const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), 'db/migrations')
migrate(db, { migrationsFolder })

const repository = new SqliteNotificationRepository(db)
const resolveRecipient = createSchlusselRecipientResolver({
  baseUrl: config.schlusselInternalUrl,
  keyId: config.schlusselKeyId,
  secret: config.schlusselSecret,
  fetchTimeoutMs: config.recipientFetchTimeoutMs,
})
const { requireAuth, requireAdmin } = createAuthMiddleware({
  jwksUrl: config.jwksUrl,
  issuer: config.jwtIssuer,
  onUserSeen: async (user) => {
    const timestamp = new Date()
    await db.insert(users).values({
      id: user.id, email: user.email, name: user.name, createdAt: timestamp, lastSeenAt: timestamp,
    }).onConflictDoUpdate({
      target: users.id,
      set: { email: user.email, name: user.name, lastSeenAt: timestamp },
    })
  },
})
const requireExportAuth = createExportAuthMiddleware({
  jwksUrl: config.jwksUrl,
  issuer: config.jwtIssuer,
  service: 'glocke',
})

const service = createApp({
  repository,
  sourceCredentials: config.producers,
  requireAuth,
  requireAdmin,
  requireExportAuth,
  maxSkewSeconds: config.maxSkewSeconds,
  maxEventBytes: config.maxEventBytes,
  ready: async () => {
    try {
      db.get(sql`select 1`)
      return true
    } catch {
      return false
    }
  },
})

const app = new Hono()
app.use('*', bodyLimit({
  maxSize: 1024 * 1024,
  onError: (context) => context.json({ error: 'Request body too large' }, 413),
}))
app.use('*', logger())
app.use('*', createCorsMiddleware({
  allowedOrigins: config.allowedOrigins,
}))
app.route('/', service)

const processor = createProcessor({ repository, resolveRecipient, createId, createLeaseId: createId, leaseMs: config.workerLeaseMs })
const workerIntervalMs = config.workerIntervalMs
let workerStopped = false
let workerRunning = false
let workerPromise: Promise<void> | null = null

function runWorker() {
  if (workerStopped || workerRunning) return
  workerRunning = true
  workerPromise = (async () => {
    try {
      while (!workerStopped && await processor.processNext() === 'processed') {
        // Drain durable work before sleeping.
      }
    } catch (error) {
      console.error('[Glocke worker] Processing failed', error)
    } finally {
      workerRunning = false
    }
  })()
}

const workerTimer = setInterval(runWorker, workerIntervalMs)
workerTimer.unref()
runWorker()

const port = config.port
const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`[Glocke API] Running on http://localhost:${port}`)
})

function shutdown(signal: string) {
  if (workerStopped) return
  workerStopped = true
  clearInterval(workerTimer)
  console.log(`[Glocke API] ${signal}; stopping`)
  server.close(() => {
    void (async () => {
      await workerPromise
      sqlite.close()
      process.exit(0)
    })()
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))

export { app }
