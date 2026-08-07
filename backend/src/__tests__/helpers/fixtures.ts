import { createHash } from 'node:crypto'
import { signNotificationRequest } from '@zudar107/schloss-server-kit'
import type { EventEnvelope, InboxRecord, NotificationRecord } from '../../contracts.js'

export const EVENT_SECRET = 'test-only-secret-with-at-least-32-bytes'
export const EVENT_KEY_ID = 'tafel-test'

export function eventEnvelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    version: '1',
    id: '10000000-0000-4000-8000-000000000001',
    source: 'tafel',
    type: 'task.due',
    occurredAt: '2026-08-07T10:00:00.000Z',
    correlationId: '20000000-0000-4000-8000-000000000001',
    payload: {
      recipientId: 'user-1',
      title: 'Task is due',
      body: 'Prepare release notes',
      actionUrl: '/tasks/task-1',
    },
    ...overrides,
  }
}

export function signedEventRequest(envelope: unknown, secret = EVENT_SECRET): RequestInit {
  const body = JSON.stringify(envelope)
  const source = typeof envelope === 'object' && envelope !== null && 'source' in envelope
    ? String(envelope.source)
    : 'tafel'
  const keyId = `${source}-test`
  const timestamp = Math.floor(Date.now() / 1_000)
  const signature = signNotificationRequest({
    secret, keyId, source, timestamp, method: 'POST', path: '/internal/v1/events', rawBody: body,
  })
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hof-Service': source,
      'X-Hof-Key-Id': keyId,
      'X-Hof-Timestamp': String(timestamp),
      'X-Hof-Signature': signature,
    },
    body,
  }
}

export function inboxRecord(overrides: Partial<InboxRecord> = {}): InboxRecord {
  const envelope = overrides.envelope ?? eventEnvelope()
  return {
    eventId: envelope.id,
    source: envelope.source,
    userId: envelope.payload.recipientId,
    payloadHash: createHash('sha256').update(JSON.stringify(envelope)).digest('hex'),
    envelope,
    status: 'pending',
    acceptedAt: '2026-08-07T10:00:01.000Z',
    processedAt: null,
    leaseUntil: null,
    leaseId: null,
    ...overrides,
  }
}

export function notificationRecord(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: 'notification-1',
    eventId: '10000000-0000-4000-8000-000000000001',
    userId: 'user-1',
    source: 'tafel',
    type: 'task.due',
    title: 'Task is due',
    body: 'Prepare release notes',
    actionUrl: '/tasks/task-1',
    createdAt: '2026-08-07T10:00:02.000Z',
    readAt: null,
    ...overrides,
  }
}
