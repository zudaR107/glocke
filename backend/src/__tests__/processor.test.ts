import { beforeEach, describe, expect, it } from 'vitest'
import { createProcessor } from '../processor.js'
import { eventEnvelope, inboxRecord, notificationRecord } from './helpers/fixtures.js'
import { MemoryNotificationRepository } from './helpers/repository.js'

describe('inbox processing', () => {
  let repository: MemoryNotificationRepository

  beforeEach(() => {
    repository = new MemoryNotificationRepository()
  })

  function processor(notifyInApp = true) {
    return createProcessor({
      repository,
      resolveRecipient: async (userId) => ({ userId, notifyInApp }),
      now: () => new Date('2026-08-07T10:00:02.000Z'),
      createId: () => 'notification-1',
      createLeaseId: () => 'lease-1',
    })
  }

  it('processes one pending inbox event and is idle on the next pass', async () => {
    repository.seedInbox(inboxRecord())
    const worker = processor()

    expect(await worker.processNext()).toBe('processed')
    expect(await worker.processNext()).toBe('idle')
    expect(repository.inbox[0]).toMatchObject({ status: 'processed' })
    expect(repository.notifications).toHaveLength(1)
  })

  it('is idempotent when notification creation committed before inbox completion failed', async () => {
    repository.seedInbox(inboxRecord())
    repository.failNextCompletion = true
    const worker = processor()

    await expect(worker.processNext()).rejects.toThrow('simulated completion failure')
    expect(repository.notifications).toHaveLength(1)
    repository.recoverProcessing()

    expect(await worker.processNext()).toBe('processed')
    expect(repository.notifications).toHaveLength(1)
    expect(repository.inbox[0]?.status).toBe('processed')
  })

  it('marks the inbox processed without creating a notification when notifyInApp is false', async () => {
    repository.seedInbox(inboxRecord())

    expect(await processor(false).processNext()).toBe('processed')
    expect(repository.notifications).toHaveLength(0)
    expect(repository.inbox[0]?.status).toBe('processed')
  })

  it('durably suppresses an event when the recipient no longer exists', async () => {
    repository.seedInbox(inboxRecord())
    const worker = createProcessor({
      repository,
      resolveRecipient: async () => null,
      now: () => new Date('2026-08-07T10:00:02.000Z'),
      createLeaseId: () => 'lease-1',
    })

    expect(await worker.processNext()).toBe('processed')
    expect(repository.notifications).toHaveLength(0)
    expect(repository.inbox[0]).toMatchObject({ status: 'processed', leaseId: null })
  })

  it('enforces notification uniqueness by event and recipient', async () => {
    repository.seedInbox(inboxRecord())
    repository.seedNotification(notificationRecord())

    expect(await processor().processNext()).toBe('processed')
    expect(repository.notifications).toHaveLength(1)
    expect(repository.notifications[0]).toMatchObject({ eventId: '10000000-0000-4000-8000-000000000001', userId: 'user-1' })
  })

  it('renders the minimal password-changed event in Russian', async () => {
    const envelope = eventEnvelope({
      source: 'schlussel',
      type: 'schlussel.security.password_changed.v1',
      payload: { recipientId: 'user-1' },
    })
    repository.seedInbox(inboxRecord({ envelope, source: 'schlussel' }))

    expect(await processor().processNext()).toBe('processed')
    expect(repository.notifications[0]).toMatchObject({
      title: 'Пароль изменён',
      body: 'Пароль вашей учётной записи был изменён.',
      actionUrl: '/settings',
    })
  })

  it.each([
    {
      source: 'kuvert',
      type: 'kuvert.goal.completed.v1',
      payload: { recipientId: 'user-1', goalName: 'Резервный фонд' },
      expected: {
        title: 'Цель достигнута',
        body: 'Цель «Резервный фонд» достигнута.',
        actionUrl: '/goals',
      },
    },
    {
      source: 'tafel',
      type: 'tafel.task.due.v1',
      payload: { recipientId: 'user-1', taskTitle: 'Опубликовать релиз', dueDate: '2026-08-08', overdue: false },
      expected: {
        title: 'Срок задачи приближается',
        body: 'Задачу «Опубликовать релиз» нужно выполнить до 2026-08-08.',
        actionUrl: '/tasks',
      },
    },
    {
      source: 'tafel',
      type: 'tafel.task.due.v1',
      payload: { recipientId: 'user-1', taskTitle: 'Опубликовать релиз', dueDate: '2026-08-06', overdue: true },
      expected: {
        title: 'Задача просрочена',
        body: 'Срок задачи «Опубликовать релиз» истёк 2026-08-06.',
        actionUrl: '/tasks',
      },
    },
    {
      source: 'zettel',
      type: 'zettel.note.backlink_added.v1',
      payload: { recipientId: 'user-1', sourceTitle: 'Архитектура', targetTitle: 'Glocke' },
      expected: {
        title: 'Добавлена обратная ссылка',
        body: 'Заметка «Архитектура» теперь ссылается на «Glocke».',
        actionUrl: null,
      },
    },
  ])('centrally renders $type in deterministic Russian', async ({ source, type, payload, expected }) => {
    const envelope = eventEnvelope({ source, type, payload })
    repository.seedInbox(inboxRecord({ envelope, source }))

    expect(await processor().processNext()).toBe('processed')
    expect(repository.notifications[0]).toMatchObject(expected)
  })

  it('never renders producer-controlled presentation or links', async () => {
    const envelope = eventEnvelope({
      source: 'kuvert',
      type: 'kuvert.goal.completed.v1',
      payload: {
        recipientId: 'user-1',
        goalName: 'Резервный фонд',
        title: 'Поддельный заголовок',
        body: 'Поддельный текст',
        actionUrl: 'https://attacker.invalid/collect',
      },
    })
    repository.seedInbox(inboxRecord({ envelope, source: 'kuvert' }))

    expect(await processor().processNext()).toBe('processed')
    expect(repository.notifications[0]).toMatchObject({
      title: 'Цель достигнута',
      body: 'Цель «Резервный фонд» достигнута.',
      actionUrl: '/goals',
    })
  })
})
