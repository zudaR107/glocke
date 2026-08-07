import type { ExportAuthEnv } from '@zudar107/schloss-server-kit'
import { createMiddleware } from 'hono/factory'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { inboxRecord, notificationRecord } from './helpers/fixtures.js'
import { MemoryNotificationRepository } from './helpers/repository.js'

const DIRECT_USER_1 = { Authorization: 'Bearer user-1-token' }
const DIRECT_USER_2 = { Authorization: 'Bearer user-2-token' }
const DELEGATED_USER_1 = { Authorization: 'Bearer export-user-1-token' }
const DELEGATED_USER_2 = { Authorization: 'Bearer export-user-2-token' }
const EXPORTED_AT = '2026-08-07T12:00:00.000Z'

const requireExportAuth = createMiddleware<ExportAuthEnv>(async (context, next) => {
  const token = context.req.header('Authorization')
  const userId = token === DIRECT_USER_1.Authorization || token === DELEGATED_USER_1.Authorization
    ? 'user-1'
    : token === DIRECT_USER_2.Authorization || token === DELEGATED_USER_2.Authorization
      ? 'user-2'
      : null
  if (!userId) return context.json({ error: 'Unauthorized' }, 401)
  const delegated = token === DELEGATED_USER_1.Authorization || token === DELEGATED_USER_2.Authorization
  context.set('exportPrincipal', delegated
    ? { sub: userId, kind: 'delegation', jobId: `job-${userId}` }
    : { sub: userId, kind: 'access' })
  await next()
})

describe('GET /exports/me', () => {
  let repository: MemoryNotificationRepository
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    repository = new MemoryNotificationRepository()
    app = createApp({
      repository,
      sourceCredentials: {
        tafel: { keyId: 'transport-key-must-not-export', secret: 'hmac-secret-must-not-export' },
      },
      authenticate: async (request) => {
        const token = request.headers.get('Authorization')
        if (token === DIRECT_USER_1.Authorization) return 'user-1'
        if (token === DIRECT_USER_2.Authorization) return 'user-2'
        return null
      },
      requireExportAuth,
      now: () => new Date(EXPORTED_AT),
    })
  })

  it.each([
    ['a normal Glocke access token', DIRECT_USER_1],
    ['a scoped delegated export token', DELEGATED_USER_1],
  ])('returns the standardized snapshot envelope with %s', async (_kind, headers) => {
    repository.seedNotification(notificationRecord({
      id: 'unread-notification',
      eventId: 'unread-event',
      title: 'Unread title',
      body: 'Unread body',
      readAt: null,
    }))
    repository.seedNotification(notificationRecord({
      id: 'read-notification',
      eventId: 'read-event',
      source: 'schlussel',
      type: 'security.password_changed',
      title: 'Read title',
      body: 'Read body',
      actionUrl: null,
      createdAt: '2026-08-07T11:00:00.000Z',
      readAt: '2026-08-07T11:05:00.000Z',
    }))

    const response = await app.request('/exports/me', { headers })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^application\/json\b/)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('pragma')).toBe('no-cache')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    const body = await response.json() as Record<string, any>
    expect(body).toEqual({
      version: '1',
      service: 'glocke',
      exportedAt: EXPORTED_AT,
      data: {
        notifications: [
          {
            id: 'read-notification',
            eventId: 'read-event',
            source: 'schlussel',
            type: 'security.password_changed',
            title: 'Read title',
            body: 'Read body',
            actionUrl: null,
            createdAt: '2026-08-07T11:00:00.000Z',
            readAt: '2026-08-07T11:05:00.000Z',
          },
          {
            id: 'unread-notification',
            eventId: 'unread-event',
            source: 'tafel',
            type: 'task.due',
            title: 'Unread title',
            body: 'Unread body',
            actionUrl: '/tasks/task-1',
            createdAt: '2026-08-07T10:00:02.000Z',
            readAt: null,
          },
        ],
      },
    })
  })

  it.each([
    ['direct', DIRECT_USER_1, ['mine-delegated', 'mine-direct']],
    ['delegated', DELEGATED_USER_2, ['theirs-delegated', 'theirs-direct']],
  ])('strictly isolates the %s export to the authenticated subject', async (_kind, headers, expectedIds) => {
    repository.seedNotification(notificationRecord({ id: 'mine-direct', eventId: 'event-1', userId: 'user-1' }))
    repository.seedNotification(notificationRecord({ id: 'theirs-direct', eventId: 'event-2', userId: 'user-2' }))
    repository.seedNotification(notificationRecord({ id: 'theirs-delegated', eventId: 'event-3', userId: 'user-2' }))
    repository.seedNotification(notificationRecord({ id: 'mine-delegated', eventId: 'event-4', userId: 'user-1' }))

    const response = await app.request('/exports/me', { headers })
    expect(response.status).toBe(200)
    const body = await response.json() as { data: { notifications: Array<{ id: string }> } }
    expect(body.data.notifications.map((notification) => notification.id).sort()).toEqual(expectedIds)
  })

  it('exports every notification rather than one normal list page', async () => {
    for (let index = 0; index < 101; index += 1) {
      repository.seedNotification(notificationRecord({
        id: `notification-${index}`,
        eventId: `event-${index}`,
        createdAt: new Date(Date.UTC(2026, 7, 7, 10, 0, index)).toISOString(),
      }))
    }

    const response = await app.request('/exports/me', { headers: DIRECT_USER_1 })
    expect(response.status).toBe(200)
    const body = await response.json() as { data: { notifications: unknown[] } }
    expect(body.data.notifications).toHaveLength(101)
  })

  it('excludes operational inbox, lease, payload hash, user ownership, and HMAC credential data', async () => {
    repository.seedNotification(notificationRecord({ id: 'visible-notification' }))
    repository.seedInbox(inboxRecord({
      status: 'processing',
      payloadHash: 'payload-hash-must-not-export',
      leaseUntil: '2026-08-07T12:05:00.000Z',
      leaseId: 'lease-id-must-not-export',
    }))

    const response = await app.request('/exports/me', { headers: DELEGATED_USER_1 })
    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, any>
    const serialized = JSON.stringify(body)

    expect(Object.keys(body).sort()).toEqual(['data', 'exportedAt', 'service', 'version'])
    expect(Object.keys(body.data)).toEqual(['notifications'])
    expect(Object.keys(body.data.notifications[0]).sort()).toEqual([
      'actionUrl', 'body', 'createdAt', 'eventId', 'id', 'readAt', 'source', 'title', 'type',
    ])
    for (const forbidden of [
      'inbox',
      'payload-hash-must-not-export',
      'lease-id-must-not-export',
      'transport-key-must-not-export',
      'hmac-secret-must-not-export',
      'userId',
    ]) expect(serialized).not.toContain(forbidden)
  })

  it('requires authentication and does not grant delegated export tokens access to normal APIs', async () => {
    const missing = await app.request('/exports/me')
    expect(missing.status).toBe(401)
    expect(missing.headers.get('cache-control')).toBe('private, no-store')
    expect(missing.headers.get('pragma')).toBe('no-cache')
    expect(missing.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await app.request('/exports/me', {
      headers: { Authorization: 'Bearer invalid-token' },
    })).status).toBe(401)
    expect((await app.request('/notifications', { headers: DELEGATED_USER_1 })).status).toBe(401)
  })
})
