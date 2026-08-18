import { describe, expect, it } from 'vitest'
import { buildNotificationOptions, parsePushPayload, type PushPayload } from '../sw/pushPayload'

// Implementation contract (not yet implemented — module-not-found expected
// until frontend/src/sw/pushPayload.ts exists):
//
//   export interface PushPayload { id: string; text: string; url: string }
//   export function parsePushPayload(raw: string): PushPayload | null
//   export function buildNotificationOptions(payload: PushPayload): {
//     body: string
//     tag: string
//     data: { url: string; id: string }
//   }
//
// This is the "extracted testable function" the real /sw.js `push` handler
// is expected to call as `const payload = parsePushPayload(event.data?.text() ?? '')`
// (raw string in, so JSON.parse failures are contained inside the function
// under test rather than in the untestable ServiceWorkerGlobalScope). Per
// spec, the wire payload carries ONLY a generic delivery id, neutral
// presentation text, and a trusted destination URL — never event
// title/body/domain data — so parsePushPayload's job is strict shape
// validation, not free-form passthrough.

const validRaw = JSON.stringify({
  id: 'delivery-42',
  text: 'У вас новое уведомление',
  url: 'https://glocke.example.com/notifications/delivery-42',
})

describe('parsePushPayload', () => {
  it('parses a well-formed generic payload', () => {
    expect(parsePushPayload(validRaw)).toEqual({
      id: 'delivery-42',
      text: 'У вас новое уведомление',
      url: 'https://glocke.example.com/notifications/delivery-42',
    })
  })

  it('returns null for syntactically invalid JSON', () => {
    expect(parsePushPayload('not json at all {{{')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parsePushPayload('')).toBeNull()
  })

  it('returns null when a required field is missing', () => {
    expect(parsePushPayload(JSON.stringify({ id: 'x', text: 'hi' }))).toBeNull() // missing url
    expect(parsePushPayload(JSON.stringify({ id: 'x', url: 'https://a.example/' }))).toBeNull() // missing text
    expect(parsePushPayload(JSON.stringify({ text: 'hi', url: 'https://a.example/' }))).toBeNull() // missing id
  })

  it('returns null when a field has the wrong type', () => {
    expect(parsePushPayload(JSON.stringify({ id: 123, text: 'hi', url: 'https://a.example/' }))).toBeNull()
    expect(parsePushPayload(JSON.stringify({ id: 'x', text: null, url: 'https://a.example/' }))).toBeNull()
    expect(parsePushPayload(JSON.stringify({ id: 'x', text: 'hi', url: 42 }))).toBeNull()
  })

  it('returns null for a JSON array or primitive instead of an object', () => {
    expect(parsePushPayload('[]')).toBeNull()
    expect(parsePushPayload('"just a string"')).toBeNull()
    expect(parsePushPayload('42')).toBeNull()
    expect(parsePushPayload('null')).toBeNull()
  })

  it('drops unexpected/domain-specific keys instead of leaking them through', () => {
    // Guards against a producer bug that accidentally puts event title/body
    // on the wire payload: parsePushPayload must only ever surface the
    // whitelisted generic fields.
    const raw = JSON.stringify({
      id: 'delivery-1',
      text: 'У вас новое уведомление',
      url: 'https://glocke.example.com/notifications/delivery-1',
      title: 'Bud due tomorrow',
      body: 'Secret domain content',
    })
    const result = parsePushPayload(raw)
    expect(result).toEqual({
      id: 'delivery-1',
      text: 'У вас новое уведомление',
      url: 'https://glocke.example.com/notifications/delivery-1',
    })
    expect(result).not.toHaveProperty('title')
    expect(result).not.toHaveProperty('body')
  })
})

describe('buildNotificationOptions', () => {
  const payload: PushPayload = {
    id: 'delivery-7',
    text: 'У вас новое уведомление',
    url: 'https://glocke.example.com/notifications/delivery-7',
  }

  it('uses the delivery id as the notification tag', () => {
    const options = buildNotificationOptions(payload)
    expect(options.tag).toBe('delivery-7')
  })

  it('carries the generic text as the notification body', () => {
    expect(buildNotificationOptions(payload).body).toBe('У вас новое уведомление')
  })

  it('carries the destination url in data for the click handler', () => {
    expect(buildNotificationOptions(payload).data.url).toBe('https://glocke.example.com/notifications/delivery-7')
  })

  it('produces the same tag for redeliveries of the same event (OS-level dedup)', () => {
    const first = buildNotificationOptions(payload)
    const second = buildNotificationOptions({ ...payload, text: 'У вас новое уведомление' })
    expect(first.tag).toBe(second.tag)
  })

  it('produces a different tag for a different delivery id', () => {
    const first = buildNotificationOptions(payload)
    const second = buildNotificationOptions({ ...payload, id: 'delivery-8' })
    expect(first.tag).not.toBe(second.tag)
  })
})
