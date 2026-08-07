import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { notificationRecord } from './helpers/fixtures.js'
import { MemoryNotificationRepository } from './helpers/repository.js'

const USER_1_HEADERS = { Authorization: 'Bearer user-1-token' }
const USER_2_HEADERS = { Authorization: 'Bearer user-2-token' }

describe('notification APIs', () => {
  let repository: MemoryNotificationRepository
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    repository = new MemoryNotificationRepository()
    app = createApp({
      repository,
      sourceSecrets: {},
      authenticate: async (request) => {
        const token = request.headers.get('Authorization')
        if (token === 'Bearer user-1-token') return 'user-1'
        if (token === 'Bearer user-2-token') return 'user-2'
        return null
      },
    })
  })

  it('lists newest notifications first and returns an opaque next cursor', async () => {
    repository.seedNotification(notificationRecord({
      id: 'notification-1',
      eventId: 'evt-1',
      createdAt: '2026-08-07T10:00:01.000Z',
    }))
    repository.seedNotification(notificationRecord({
      id: 'notification-2',
      eventId: 'evt-2',
      createdAt: '2026-08-07T10:00:02.000Z',
    }))
    repository.seedNotification(notificationRecord({
      id: 'notification-3',
      eventId: 'evt-3',
      createdAt: '2026-08-07T10:00:03.000Z',
    }))

    const firstResponse = await app.request('/notifications?limit=2', { headers: USER_1_HEADERS })
    expect(firstResponse.status).toBe(200)
    const first = await firstResponse.json() as {
      items: Array<{ id: string }>
      nextCursor: string | null
    }
    expect(first.items.map((item) => item.id)).toEqual(['notification-3', 'notification-2'])
    expect(first.nextCursor).toEqual(expect.any(String))

    const secondResponse = await app.request(
      `/notifications?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
      { headers: USER_1_HEADERS },
    )
    expect(secondResponse.status).toBe(200)
    const second = await secondResponse.json() as {
      items: Array<{ id: string }>
      nextCursor: string | null
    }
    expect(second).toEqual({ items: [expect.objectContaining({ id: 'notification-1' })], nextCursor: null })
  })

  it.each(['1.5', 'NaN', 'Infinity', '-Infinity'])('rejects invalid notification limit %s', async (limit) => {
    const response = await app.request(`/notifications?limit=${encodeURIComponent(limit)}`, { headers: USER_1_HEADERS })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'limit must be an integer between 1 and 100' })
  })

  it('returns only the authenticated user notifications', async () => {
    repository.seedNotification(notificationRecord({ id: 'mine', eventId: 'mine', userId: 'user-1' }))
    repository.seedNotification(notificationRecord({ id: 'theirs', eventId: 'theirs', userId: 'user-2' }))

    const response = await app.request('/notifications', { headers: USER_1_HEADERS })
    const body = await response.json() as { items: Array<{ id: string }> }

    expect(response.status).toBe(200)
    expect(body.items.map((item) => item.id)).toEqual(['mine'])
  })

  it('returns the authenticated user unread count', async () => {
    repository.seedNotification(notificationRecord({ id: 'unread', eventId: 'evt-unread' }))
    repository.seedNotification(notificationRecord({
      id: 'read',
      eventId: 'evt-read',
      readAt: '2026-08-07T11:00:00.000Z',
    }))
    repository.seedNotification(notificationRecord({
      id: 'other-user',
      eventId: 'evt-other-user',
      userId: 'user-2',
    }))

    const response = await app.request('/notifications/unread-count', { headers: USER_1_HEADERS })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ count: 1 })
  })

  it('marks one owned notification read and is idempotent', async () => {
    repository.seedNotification(notificationRecord({ id: 'owned' }))

    const first = await app.request('/notifications/owned/read', {
      method: 'POST',
      headers: USER_1_HEADERS,
    })
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ id: 'owned', readAt: expect.any(String) })

    const readAt = repository.notifications[0]?.readAt
    const second = await app.request('/notifications/owned/read', {
      method: 'POST',
      headers: USER_1_HEADERS,
    })
    expect(second.status).toBe(200)
    expect((await second.json() as { readAt: string }).readAt).toBe(readAt)
  })

  it('marks all owned unread notifications read', async () => {
    repository.seedNotification(notificationRecord({ id: 'one', eventId: 'evt-one' }))
    repository.seedNotification(notificationRecord({ id: 'two', eventId: 'evt-two' }))
    repository.seedNotification(notificationRecord({
      id: 'other-user',
      eventId: 'evt-other-user',
      userId: 'user-2',
    }))

    const response = await app.request('/notifications/read-all', {
      method: 'POST',
      headers: USER_1_HEADERS,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ updated: 2 })
    expect(repository.notifications.filter((notification) => (
      notification.userId === 'user-1' && notification.readAt === null
    ))).toHaveLength(0)
    expect(repository.notifications.find((notification) => notification.userId === 'user-2')?.readAt).toBeNull()
  })

  it('deletes one owned notification', async () => {
    repository.seedNotification(notificationRecord({ id: 'owned' }))

    const response = await app.request('/notifications/owned', {
      method: 'DELETE',
      headers: USER_1_HEADERS,
    })

    expect(response.status).toBe(204)
    expect(repository.notifications).toHaveLength(0)
  })

  it.each([
    ['POST', '/notifications/foreign/read'],
    ['DELETE', '/notifications/foreign'],
  ])('does not allow %s against another user notification', async (method, path) => {
    repository.seedNotification(notificationRecord({ id: 'foreign', userId: 'user-1' }))

    const response = await app.request(path, { method, headers: USER_2_HEADERS })

    expect(response.status).toBe(404)
    expect(repository.notifications[0]).toMatchObject({ id: 'foreign', readAt: null })
  })

  it.each([
    ['GET', '/notifications'],
    ['GET', '/notifications/unread-count'],
    ['POST', '/notifications/notification-1/read'],
    ['POST', '/notifications/read-all'],
    ['DELETE', '/notifications/notification-1'],
  ])('returns 401 for unauthenticated %s %s', async (method, path) => {
    const response = await app.request(path, { method })

    expect(response.status).toBe(401)
  })
})
