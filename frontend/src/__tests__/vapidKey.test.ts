import { describe, expect, it } from 'vitest'
import { urlBase64ToUint8Array } from '../lib/push/vapidKey'

// Implementation contract (not yet implemented — this file is expected to
// fail with a module-not-found error until frontend/src/lib/push/vapidKey.ts
// exists):
//
//   export function urlBase64ToUint8Array(base64Url: string): Uint8Array
//
// Converts a base64url-encoded string (the shape the backend's
// `vapidPublicKey` field from GET /notifications/push/status is expected to
// be in) into the raw Uint8Array required by
// `PushManager.subscribe({ applicationServerKey })`. This is the classic
// push-notification off-by-one/padding bug (see web.dev's applicationServerKey
// helper for the canonical algorithm this mirrors): base64url uses '-'/'_' in
// place of '+'/'/' and conventionally omits '=' padding, both of which
// standard atob()/Buffer base64 decoding require.
//
// Each expectation below is derived independently via Node's built-in
// 'base64url' Buffer encoding (not by re-implementing the algorithm under
// test), so these are true fixed-point vectors, not tautologies.

function toBase64Url(bytes: number[]): string {
  return Buffer.from(Uint8Array.from(bytes)).toString('base64url')
}

function expectedBytes(base64Url: string): number[] {
  return Array.from(Buffer.from(base64Url, 'base64url'))
}

describe('urlBase64ToUint8Array', () => {
  it('decodes a realistic 65-byte uncompressed P-256 VAPID public key', () => {
    // Real-world-shaped VAPID public key literal (the well-known web.dev
    // push-notifications sample key) — 65 bytes, leading 0x04 marker for an
    // uncompressed EC point.
    const key = 'BEl62iUYgUivxIkv69yViEuiBIa40HI0DLLuxazjxTQyxUAsxdWyPRXHy8jSGKk8jKZ0v3OA5rVUZ0KKnj8bJx0'
    const result = urlBase64ToUint8Array(key)

    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(65)
    expect(Array.from(result)).toEqual(expectedBytes(key))
  })

  it('returns an empty Uint8Array for an empty string', () => {
    const result = urlBase64ToUint8Array('')
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(0)
  })

  it.each([
    ['1 byte (needs "==" padding)', [7]],
    ['2 bytes (needs "=" padding)', [7, 42]],
    ['3 bytes (needs no padding)', [7, 42, 255]],
    ['4 bytes (needs "==" padding)', [1, 2, 3, 4]],
    ['5 bytes (needs "=" padding)', [1, 2, 3, 4, 5]],
    ['6 bytes (needs no padding)', [1, 2, 3, 4, 5, 6]],
  ] as const)('decodes correctly for %s', (_label, bytes) => {
    const encoded = toBase64Url([...bytes])
    expect(Array.from(urlBase64ToUint8Array(encoded))).toEqual([...bytes])
  })

  it('translates base64url "-" and "_" characters distinctly from standard base64 "+" and "/"', () => {
    // Byte values chosen so the standard base64 alphabet would render at
    // least one '+' and one '/' — this exercises the '-'->'+' and '_'->'/'
    // substitution the source is expected to perform.
    const bytes = [251, 239, 190, 255, 239, 190]
    const encoded = toBase64Url(bytes)
    expect(encoded).toMatch(/[-_]/) // sanity: the fixture actually needs substitution
    expect(Array.from(urlBase64ToUint8Array(encoded))).toEqual(bytes)
  })

  it('round-trips a longer arbitrary byte sequence', () => {
    const bytes = Array.from({ length: 33 }, (_, i) => (i * 37 + 11) % 256)
    const encoded = toBase64Url(bytes)
    expect(Array.from(urlBase64ToUint8Array(encoded))).toEqual(bytes)
  })
})
