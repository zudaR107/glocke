import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { createHttpApp } from '../http.js'
import { notificationRecord } from './helpers/fixtures.js'
import { MemoryNotificationRepository } from './helpers/repository.js'

const USER_1_HEADERS = { Authorization: 'Bearer user-1-token' }
const USER_2_HEADERS = { Authorization: 'Bearer user-2-token' }

function expectPrivateNotificationResponse(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect(response.headers.get('Pragma')).toBe('no-cache')
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
}

describe('DELETE /notifications', () => {
  let repository: MemoryNotificationRepository
  let app: ReturnType<typeof createHttpApp>

  beforeEach(() => {
    repository = new MemoryNotificationRepository()
    const service = createApp({
      repository,
      sourceSecrets: {},
      authenticate: async (request) => {
        const token = request.headers.get('Authorization')
        if (token === 'Bearer user-1-token') return 'user-1'
        if (token === 'Bearer user-2-token') return 'user-2'
        return null
      },
    })
    app = createHttpApp(service, ['https://tafel.localhost'], false)
  })

  it('deletes every notification owned by the caller regardless of read state and returns the count', async () => {
    repository.seedNotification(notificationRecord({ id: 'unread', eventId: 'evt-unread' }))
    repository.seedNotification(notificationRecord({
      id: 'read',
      eventId: 'evt-read',
      readAt: '2026-08-07T11:00:00.000Z',
    }))

    const response = await app.request('/notifications', {
      method: 'DELETE',
      headers: USER_1_HEADERS,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ deleted: 2 })
    expect(repository.notifications).toHaveLength(0)
  })

  it('returns deleted: 0 when the caller has no notifications', async () => {
    const response = await app.request('/notifications', {
      method: 'DELETE',
      headers: USER_1_HEADERS,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ deleted: 0 })
  })

  it('does not touch another user notifications', async () => {
    repository.seedNotification(notificationRecord({ id: 'mine', eventId: 'evt-mine', userId: 'user-1' }))
    repository.seedNotification(notificationRecord({ id: 'theirs', eventId: 'evt-theirs', userId: 'user-2' }))

    const response = await app.request('/notifications', {
      method: 'DELETE',
      headers: USER_1_HEADERS,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ deleted: 1 })
    expect(repository.notifications).toHaveLength(1)
    expect(repository.notifications[0]).toMatchObject({ id: 'theirs', userId: 'user-2' })
  })

  it('leaves the caller list empty and unread-count at 0 afterward, without affecting another user', async () => {
    repository.seedNotification(notificationRecord({ id: 'mine-unread', eventId: 'evt-mine-unread', userId: 'user-1' }))
    repository.seedNotification(notificationRecord({
      id: 'mine-read',
      eventId: 'evt-mine-read',
      userId: 'user-1',
      readAt: '2026-08-07T11:00:00.000Z',
    }))
    repository.seedNotification(notificationRecord({ id: 'their-unread', eventId: 'evt-their-unread', userId: 'user-2' }))

    const deleteResponse = await app.request('/notifications', {
      method: 'DELETE',
      headers: USER_1_HEADERS,
    })
    expect(deleteResponse.status).toBe(200)
    expect(await deleteResponse.json()).toEqual({ deleted: 2 })

    const listResponse = await app.request('/notifications', { headers: USER_1_HEADERS })
    expect(listResponse.status).toBe(200)
    expect(await listResponse.json()).toEqual({ items: [], nextCursor: null })

    const unreadResponse = await app.request('/notifications/unread-count', { headers: USER_1_HEADERS })
    expect(unreadResponse.status).toBe(200)
    expect(await unreadResponse.json()).toEqual({ count: 0 })

    const theirListResponse = await app.request('/notifications', { headers: USER_2_HEADERS })
    expect(theirListResponse.status).toBe(200)
    const theirList = await theirListResponse.json() as { items: Array<{ id: string }> }
    expect(theirList.items.map((item) => item.id)).toEqual(['their-unread'])

    const theirUnreadResponse = await app.request('/notifications/unread-count', { headers: USER_2_HEADERS })
    expect(theirUnreadResponse.status).toBe(200)
    expect(await theirUnreadResponse.json()).toEqual({ count: 1 })
  })

  it('marks the response private and non-cacheable', async () => {
    repository.seedNotification(notificationRecord({ id: 'owned' }))

    const response = await app.request('/notifications', {
      method: 'DELETE',
      headers: USER_1_HEADERS,
    })

    expect(response.status).toBe(200)
    expectPrivateNotificationResponse(response)
  })

  it('returns 401 for an unauthenticated request', async () => {
    const response = await app.request('/notifications', { method: 'DELETE' })

    expect(response.status).toBe(401)
    expectPrivateNotificationResponse(response)
  })
})
