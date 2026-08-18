import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import type { NotificationRecord } from '../contracts.js'
import * as schema from '../db/schema.js'
import { notifications } from '../db/schema.js'
import { SqliteNotificationRepository } from '../repository.js'
import { createProcessor } from '../processor.js'
import { EVENT_SECRET, eventEnvelope, inboxRecord, notificationRecord, signedEventRequest } from './helpers/fixtures.js'

describe('SqliteNotificationRepository', () => {
  let path: string
  let sqlite: Database.Database
  let database: ReturnType<typeof drizzle<typeof schema>>
  let repository: SqliteNotificationRepository

  beforeEach(() => {
    path = join(tmpdir(), `glocke-repository-${randomUUID()}.db`)
    sqlite = new Database(path)
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')
    database = drizzle(sqlite, { schema })
    migrate(database, { migrationsFolder: fileURLToPath(new URL('../db/migrations', import.meta.url)) })
    repository = new SqliteNotificationRepository(database)
  })

  afterEach(() => {
    sqlite.close()
    rmSync(path, { force: true })
    rmSync(`${path}-shm`, { force: true })
    rmSync(`${path}-wal`, { force: true })
  })

  it('durably accepts, deduplicates, and conflicts through createApp without recipient I/O', async () => {
    const app = createApp({
      repository,
      sourceSecrets: { tafel: EVENT_SECRET },
      authenticate: async () => null,
    })
    const original = eventEnvelope()
    const changed = eventEnvelope({ payload: {
      recipientId: 'user-1', taskTitle: 'Другой заголовок', dueDate: '2026-08-08', overdue: false,
    } })

    expect((await app.request('/internal/v1/events', signedEventRequest(original))).status).toBe(202)
    expect((await app.request('/internal/v1/events', signedEventRequest(original))).status).toBe(200)
    expect((await app.request('/internal/v1/events', signedEventRequest(changed))).status).toBe(409)
    expect(sqlite.prepare('SELECT count(*) AS count FROM inbox_events').get()).toEqual({ count: 1 })
  })

  it('recovers expired claims and fences stale materialization and completion', async () => {
    await repository.acceptInbox(inboxRecord())
    const first = await repository.claimPendingInbox(
      '2026-08-07T10:00:00.000Z', '2026-08-07T10:00:10.000Z', 'lease-old',
    )
    expect(first?.leaseId).toBe('lease-old')
    expect(await repository.claimPendingInbox(
      '2026-08-07T10:00:05.000Z', '2026-08-07T10:00:15.000Z', 'lease-early',
    )).toBeNull()
    const renewed = await repository.claimPendingInbox(
      '2026-08-07T10:00:11.000Z', '2026-08-07T10:00:21.000Z', 'lease-new',
    )
    expect(renewed?.leaseId).toBe('lease-new')

    expect(await repository.createNotification(notificationRecord(), 'lease-old', '2026-08-07T10:00:12.000Z')).toBe('stale')
    expect(await repository.markInboxProcessed(
      renewed!.source, renewed!.eventId, 'lease-old', '2026-08-07T10:00:12.000Z',
    )).toBe(false)
    expect(await repository.createNotification(notificationRecord(), 'lease-new', '2026-08-07T10:00:12.000Z')).toBe('created')
    expect(await repository.createNotification(notificationRecord({ id: 'different-id' }), 'lease-new', '2026-08-07T10:00:12.000Z')).toBe('duplicate')
    expect(await repository.markInboxProcessed(
      renewed!.source, renewed!.eventId, 'lease-new', '2026-08-07T10:00:12.000Z',
    )).toBe(true)
  })

  it('claims and suppresses corrupt envelope JSON without starving later work', async () => {
    sqlite.prepare(`INSERT INTO inbox_events
      (source, event_id, user_id, payload_hash, envelope, status, accepted_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)`).run(
      'tafel', '10000000-0000-4000-8000-000000000010', 'user-1', 'corrupt', '{',
      new Date('2026-08-07T10:00:00.000Z').getTime(),
    )
    await repository.acceptInbox(inboxRecord({
      eventId: '10000000-0000-4000-8000-000000000011',
      envelope: eventEnvelope({ id: '10000000-0000-4000-8000-000000000011' }),
      acceptedAt: '2026-08-07T10:00:01.000Z',
    }))
    const processor = createProcessor({
      repository,
      resolveRecipient: async (userId) => ({ userId, notifyInApp: true, notifyBrowserPush: false }),
      now: () => new Date('2026-08-07T10:00:02.000Z'),
      createId: () => 'notification-valid',
      createLeaseId: randomUUID,
    })

    expect(await processor.processNext()).toBe('processed')
    expect(sqlite.prepare(`SELECT status FROM inbox_events WHERE event_id =
      '10000000-0000-4000-8000-000000000010'`).get()).toEqual({ status: 'processed' })
    expect(await processor.processNext()).toBe('processed')
    expect(await repository.listNotifications('user-1', null, 10)).toMatchObject({
      items: [expect.objectContaining({ id: 'notification-valid' })],
    })
  })

  it('paginates, reads, counts, and deletes only caller-owned notifications', async () => {
    database.insert(notifications).values([
      { ...notificationRecord({ id: 'one', eventId: 'one' }), createdAt: new Date('2026-08-07T10:00:01.000Z'), readAt: null },
      { ...notificationRecord({ id: 'two', eventId: 'two' }), createdAt: new Date('2026-08-07T10:00:02.000Z'), readAt: null },
      { ...notificationRecord({ id: 'three', eventId: 'three' }), createdAt: new Date('2026-08-07T10:00:03.000Z'), readAt: null },
      { ...notificationRecord({ id: 'foreign', eventId: 'foreign', userId: 'user-2' }), createdAt: new Date('2026-08-07T10:00:04.000Z'), readAt: null },
    ]).run()

    const first = await repository.listNotifications('user-1', null, 2)
    expect(first.items.map((item) => item.id)).toEqual(['three', 'two'])
    expect(first.nextCursor).toEqual(expect.any(String))
    expect((await repository.listNotifications('user-1', first.nextCursor, 2)).items.map((item) => item.id)).toEqual(['one'])
    expect(await repository.unreadCount('user-1')).toBe(3)
    expect(await repository.markRead('user-2', 'one', new Date().toISOString())).toBeNull()
    expect(await repository.markRead('user-1', 'one', '2026-08-07T11:00:00.000Z')).toMatchObject({ id: 'one' })
    expect(await repository.markAllRead('user-1', '2026-08-07T11:01:00.000Z')).toBe(2)
    expect(await repository.unreadCount('user-1')).toBe(0)
    expect(await repository.unreadCount('user-2')).toBe(1)
    expect(await repository.deleteNotification('user-2', 'two')).toBe(false)
    expect(await repository.deleteNotification('user-1', 'two')).toBe(true)
  })

  it('exports every caller-owned notification with read state and no page limit', async () => {
    for (let index = 0; index < 101; index += 1) {
      database.insert(notifications).values({
        ...notificationRecord({
          id: `owned-${index}`,
          eventId: `owned-event-${index}`,
          readAt: index === 0 ? '2026-08-07T11:00:00.000Z' : null,
        }),
        createdAt: new Date(Date.UTC(2026, 7, 7, 10, 0, index)),
        readAt: index === 0 ? new Date('2026-08-07T11:00:00.000Z') : null,
      }).run()
    }
    database.insert(notifications).values({
      ...notificationRecord({ id: 'foreign-export', eventId: 'foreign-export', userId: 'user-2' }),
      createdAt: new Date('2026-08-07T12:00:00.000Z'),
      readAt: null,
    }).run()

    const exported: NotificationRecord[] = await repository.exportNotifications('user-1')

    expect(exported).toHaveLength(101)
    expect(exported.every((notification) => notification.userId === 'user-1')).toBe(true)
    expect(exported.some((notification) => notification.id === 'foreign-export')).toBe(false)
    expect(exported.find((notification) => notification.id === 'owned-0')?.readAt).toBe(
      '2026-08-07T11:00:00.000Z',
    )
  })
})
