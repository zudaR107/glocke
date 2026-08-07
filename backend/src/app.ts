import { createHash } from 'node:crypto'
import {
  exportEnvelopeSchema,
  notificationEventEnvelopeSchema,
  verifyNotificationRequest,
  type AuthUser,
  type ExportAuthEnv,
} from '@zudar107/schloss-server-kit'
import { Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import type { Authenticate, EventEnvelope, NotificationRepository } from './contracts.js'
import { eventRegistryByType } from './event-registry.js'

export interface ProducerCredential {
  keyId: string
  secret: string
}

export interface CreateAppOptions {
  repository: NotificationRepository
  sourceCredentials?: Readonly<Record<string, ProducerCredential>>
  /** @deprecated Test compatibility; production uses sourceCredentials. */
  sourceSecrets?: Readonly<Record<string, string>>
  authenticate?: Authenticate
  requireAuth?: MiddlewareHandler
  requireAdmin?: MiddlewareHandler
  requireExportAuth?: MiddlewareHandler<ExportAuthEnv>
  maxSkewSeconds?: number
  maxEventBytes?: number
  now?: () => Date
  ready?: () => Promise<boolean>
}

function credentials(options: CreateAppOptions): Readonly<Record<string, ProducerCredential>> {
  if (options.sourceCredentials) return options.sourceCredentials
  return Object.fromEntries(Object.entries(options.sourceSecrets ?? {}).map(([source, secret]) => [
    source,
    { keyId: `${source}-test`, secret },
  ]))
}

function testAuth(options: CreateAppOptions): MiddlewareHandler {
  return async (context, next) => {
    const userId = await options.authenticate?.(context.req.raw)
    if (!userId) return context.json({ error: 'Unauthorized' }, 401)
    context.set('user', {
      id: userId,
      email: `${userId}@test.invalid`,
      name: userId,
      role: 'user',
      weekStart: null,
      dateFormat: null,
      timezone: null,
    } satisfies AuthUser)
    await next()
  }
}

function testExportAuth(options: CreateAppOptions): MiddlewareHandler<ExportAuthEnv> {
  return async (context, next) => {
    const userId = await options.authenticate?.(context.req.raw)
    if (!userId) return context.json({ error: 'Unauthorized' }, 401)
    context.set('exportPrincipal', { sub: userId, kind: 'access' })
    await next()
  }
}

export function createApp(options: CreateAppOptions): Hono<ExportAuthEnv> {
  const app = new Hono<ExportAuthEnv>()
  const producers = credentials(options)
  const requireAuth = options.requireAuth ?? testAuth(options)
  const requireAdmin = options.requireAdmin ?? (async (_context, next) => next())
  const requireExportAuth = options.requireExportAuth ?? testExportAuth(options)
  const now = options.now ?? (() => new Date())

  app.get('/health', (context) => context.json({ status: 'ok', service: 'Glocke' }))
  app.get('/ready', async (context) => {
    const ready = await (options.ready?.() ?? Promise.resolve(true))
    return ready
      ? context.json({ status: 'ready', service: 'Glocke' })
      : context.json({ status: 'unavailable', service: 'Glocke' }, 503)
  })

  app.post('/internal/v1/events', async (context) => {
    const contentLength = Number(context.req.header('Content-Length'))
    const maxBytes = options.maxEventBytes ?? 64 * 1024
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return context.json({ error: 'Request body too large' }, 413)
    }

    const rawBytes = new Uint8Array(await context.req.raw.arrayBuffer())
    if (rawBytes.byteLength > maxBytes) return context.json({ error: 'Request body too large' }, 413)
    const rawBody = new TextDecoder().decode(rawBytes)
    const source = context.req.header('X-Hof-Service') ?? ''
    if (
      !source ||
      !context.req.header('X-Hof-Key-Id') ||
      !context.req.header('X-Hof-Timestamp') ||
      !context.req.header('X-Hof-Signature')
    ) return context.json({ error: 'Missing signature' }, 401)
    const producer = producers[source]
    if (!producer) return context.json({ error: 'Producer is not configured' }, 403)

    const timestamp = Number(context.req.header('X-Hof-Timestamp'))
    const requestUrl = new URL(context.req.url)
    const validSignature = verifyNotificationRequest({
      secret: producer.secret,
      keyId: context.req.header('X-Hof-Key-Id') ?? '',
      source,
      timestamp,
      method: context.req.method,
      path: `${requestUrl.pathname}${requestUrl.search}`,
      rawBody: rawBytes,
      signature: context.req.header('X-Hof-Signature') ?? '',
      expectedKeyId: producer.keyId,
      expectedSource: source,
      maxSkewSeconds: options.maxSkewSeconds ?? 300,
      now: () => now().getTime(),
    })
    if (!validSignature) return context.json({ error: 'Invalid signature' }, 401)

    let json: unknown
    try {
      json = JSON.parse(rawBody)
    } catch {
      return context.json({ error: 'Invalid JSON' }, 400)
    }
    const parsed = notificationEventEnvelopeSchema.safeParse(json)
    if (!parsed.success || parsed.data.source !== source) {
      return context.json({ error: 'Invalid event envelope' }, 400)
    }

    // Registry is the sole authority on which (source, type) pairs exist
    // and what shape their payload takes - a source claiming a type it
    // doesn't own, or a type this deployment never registered, is
    // rejected here regardless of whether the payload itself looks
    // otherwise valid.
    const registered = eventRegistryByType.get(parsed.data.type)
    if (!registered || registered.source !== parsed.data.source) {
      return context.json({ error: 'Invalid event envelope' }, 400)
    }
    const payload = registered.payloadSchema.safeParse(parsed.data.payload)
    if (!payload.success) {
      return context.json({ error: 'Invalid event envelope' }, 400)
    }

    const envelope = { ...parsed.data, payload: payload.data } as EventEnvelope

    const acceptedAt = now().toISOString()
    const result = await options.repository.acceptInbox({
      eventId: envelope.id,
      source: envelope.source,
      userId: envelope.payload.recipientId,
      payloadHash: createHash('sha256').update(rawBytes).digest('hex'),
      envelope,
      status: 'pending',
      acceptedAt,
      processedAt: null,
      leaseUntil: null,
      leaseId: null,
    })
    if (result === 'conflict') return context.json({ error: 'Event identity conflict' }, 409)
    if (result === 'duplicate') return context.json({ status: 'duplicate' })
    return context.json({ status: 'accepted' }, 202)
  })

  app.use('/notifications', requireAuth)
  app.use('/notifications/*', requireAuth)

  app.get('/notifications', async (context) => {
    const parsedLimit = z.coerce.number().int().min(1).max(100).safeParse(context.req.query('limit') ?? 25)
    if (!parsedLimit.success) return context.json({ error: 'limit must be an integer between 1 and 100' }, 400)
    return context.json(await options.repository.listNotifications(
      context.get('user').id,
      context.req.query('cursor') ?? null,
      parsedLimit.data,
    ))
  })
  app.get('/notifications/unread-count', async (context) => context.json({
    count: await options.repository.unreadCount(context.get('user').id),
  }))
  app.post('/notifications/read-all', async (context) => context.json({
    updated: await options.repository.markAllRead(context.get('user').id, now().toISOString()),
  }))
  app.post('/notifications/:id/read', async (context) => {
    const notification = await options.repository.markRead(
      context.get('user').id,
      context.req.param('id'),
      now().toISOString(),
    )
    return notification ? context.json(notification) : context.json({ error: 'Not found' }, 404)
  })
  app.delete('/notifications/:id', async (context) => {
    const deleted = await options.repository.deleteNotification(context.get('user').id, context.req.param('id'))
    return deleted ? context.body(null, 204) : context.json({ error: 'Not found' }, 404)
  })

  app.get('/exports/me', async (context, next) => {
    context.header('Cache-Control', 'private, no-store')
    context.header('Pragma', 'no-cache')
    context.header('X-Content-Type-Options', 'nosniff')
    await next()
  }, requireExportAuth, async (context) => {
    const principal = context.get('exportPrincipal')
    if (!principal) return context.json({ error: 'Unauthorized' }, 401)

    const notifications = (await options.repository.exportNotifications(principal.sub)).map((notification) => ({
      id: notification.id,
      eventId: notification.eventId,
      source: notification.source,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      actionUrl: notification.actionUrl,
      createdAt: notification.createdAt,
      readAt: notification.readAt,
    }))

    return context.json(exportEnvelopeSchema.parse({
      version: '1',
      service: 'glocke',
      exportedAt: now().toISOString(),
      data: { notifications },
    }))
  })

  app.get('/openapi.json', requireAuth, requireAdmin, async (context) => {
    const { openApiDocument } = await import('./openapi.js')
    return context.json(openApiDocument)
  })

  return app
}
