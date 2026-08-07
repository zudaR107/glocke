import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { EVENT_SECRET, eventEnvelope, signedEventRequest } from './helpers/fixtures.js'
import { MemoryNotificationRepository } from './helpers/repository.js'

describe('POST /internal/v1/events', () => {
  let repository: MemoryNotificationRepository
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    repository = new MemoryNotificationRepository()
    app = createApp({
      repository,
      sourceSecrets: { tafel: EVENT_SECRET },
      authenticate: async () => null,
    })
  })

  it('verifies the HMAC over the exact request body', async () => {
    const request = signedEventRequest(eventEnvelope(), 'wrong-secret-with-at-least-32-bytes')

    const response = await app.request('/internal/v1/events', request)

    expect(response.status).toBe(401)
    expect(repository.inbox).toHaveLength(0)
  })

  it('rejects a body changed after signing, including insignificant whitespace', async () => {
    const request = signedEventRequest(eventEnvelope())
    request.body = `${request.body as string} `

    const response = await app.request('/internal/v1/events', request)

    expect(response.status).toBe(401)
    expect(repository.inbox).toHaveLength(0)
  })

  it('rejects a stale timestamp and a mismatched key id', async () => {
    const stale = signedEventRequest(eventEnvelope())
    const staleHeaders = stale.headers as Record<string, string>
    staleHeaders['X-Hof-Timestamp'] = '1'
    expect((await app.request('/internal/v1/events', stale)).status).toBe(401)

    const wrongKey = signedEventRequest(eventEnvelope())
    const wrongKeyHeaders = wrongKey.headers as Record<string, string>
    wrongKeyHeaders['X-Hof-Key-Id'] = 'retired-key'
    expect((await app.request('/internal/v1/events', wrongKey)).status).toBe(401)
    expect(repository.inbox).toHaveLength(0)
  })

  it('rejects an absent HMAC', async () => {
    const response = await app.request('/internal/v1/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventEnvelope()),
    })

    expect(response.status).toBe(401)
    expect(repository.inbox).toHaveLength(0)
  })

  it.each([
    { envelope: { ...eventEnvelope(), id: '' }, field: 'id' },
    { envelope: { ...eventEnvelope(), type: '' }, field: 'type' },
    { envelope: { ...eventEnvelope(), occurredAt: 'not-a-date' }, field: 'occurredAt' },
    { envelope: { ...eventEnvelope(), payload: { recipientId: 'user-1', title: 'Missing body' } }, field: 'payload.body' },
  ])('rejects an invalid envelope at $field', async ({ envelope }) => {
    const response = await app.request('/internal/v1/events', signedEventRequest(envelope))

    expect(response.status).toBe(400)
    expect(repository.inbox).toHaveLength(0)
  })

  it('durably stores a valid event before returning 202', async () => {
    const envelope = eventEnvelope()

    const response = await app.request('/internal/v1/events', signedEventRequest(envelope))

    expect(response.status).toBe(202)
    expect(repository.inbox).toHaveLength(1)
    expect(repository.inbox[0]).toMatchObject({
      eventId: envelope.id,
      source: envelope.source,
      userId: envelope.payload.recipientId,
      status: 'pending',
      processedAt: null,
      envelope,
    })
    expect(repository.inbox[0]?.payloadHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('accepts the minimal Schlussel password-changed payload', async () => {
    app = createApp({
      repository,
      sourceSecrets: { schlussel: EVENT_SECRET },
      authenticate: async () => null,
    })
    const envelope = eventEnvelope({
      source: 'schlussel',
      type: 'schlussel.security.password_changed.v1',
      payload: { recipientId: 'user-1' },
    })

    expect((await app.request('/internal/v1/events', signedEventRequest(envelope))).status).toBe(202)
    expect(repository.inbox[0]?.envelope.payload).toEqual({ recipientId: 'user-1' })
  })

  it('returns 200 for an exact duplicate without inserting twice', async () => {
    const request = () => signedEventRequest(eventEnvelope())

    expect((await app.request('/internal/v1/events', request())).status).toBe(202)
    expect((await app.request('/internal/v1/events', request())).status).toBe(200)
    expect(repository.inbox).toHaveLength(1)
  })

  it('returns 409 when an event ID is reused with different content', async () => {
    const original = eventEnvelope()
    const changed = eventEnvelope({ payload: { recipientId: 'user-1', title: 'Changed', body: 'Different content' } })

    expect((await app.request('/internal/v1/events', signedEventRequest(original))).status).toBe(202)
    expect((await app.request('/internal/v1/events', signedEventRequest(changed))).status).toBe(409)
    expect(repository.inbox).toHaveLength(1)
  })

  it('rejects a source without a configured secret', async () => {
    const response = await app.request(
      '/internal/v1/events',
      signedEventRequest(eventEnvelope({ source: 'unknown' })),
    )

    expect(response.status).toBe(403)
    expect(repository.inbox).toHaveLength(0)
  })

  it('durably accepts an event without consulting recipient state', async () => {
    const response = await app.request(
      '/internal/v1/events',
      signedEventRequest(eventEnvelope({ payload: { recipientId: 'missing-user', title: 'Task is due', body: 'Prepare release notes' } })),
    )

    expect(response.status).toBe(202)
    expect(repository.inbox).toHaveLength(1)
    expect(repository.inbox[0]).toMatchObject({ userId: 'missing-user', status: 'pending' })
  })

  it('rejects unsafe action URLs', async () => {
    const response = await app.request('/internal/v1/events', signedEventRequest(eventEnvelope({
      payload: { recipientId: 'user-1', title: 'Unsafe', body: 'Unsafe action', actionUrl: 'javascript:alert(1)' },
    })))

    expect(response.status).toBe(400)
    expect(repository.inbox).toHaveLength(0)
  })

  it('enforces the configured event payload limit', async () => {
    app = createApp({
      repository,
      sourceSecrets: { tafel: EVENT_SECRET },
      authenticate: async () => null,
      maxEventBytes: 256,
    })
    const response = await app.request('/internal/v1/events', signedEventRequest(eventEnvelope({
      payload: { recipientId: 'user-1', title: 'Large', body: 'x'.repeat(512) },
    })))

    expect(response.status).toBe(413)
    expect(repository.inbox).toHaveLength(0)
  })
})
