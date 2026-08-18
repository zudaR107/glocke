import { describe, expect, it } from 'vitest'
import { resolveTrustedUrl } from '../sw/trustedUrl'

// Implementation contract (not yet implemented — module-not-found expected
// until frontend/src/sw/trustedUrl.ts exists):
//
//   export function resolveTrustedUrl(candidate: unknown, fallback = '/notifications'): string
//
// Used both by the `push` handler (to validate the destination url carried
// in the parsed payload before storing it in notification `data`) and by
// `notificationclick` (to validate before opening/focusing). Per spec:
// "Destination must be HTTPS or an exact-match localhost dev URL — anything
// else falls back to /notifications."

describe('resolveTrustedUrl', () => {
  it('accepts a valid https url unchanged', () => {
    const url = 'https://glocke.example.com/notifications/delivery-1'
    expect(resolveTrustedUrl(url)).toBe(url)
  })

  it('accepts the localhost dev exception over plain http', () => {
    const url = 'http://localhost:5177/notifications/delivery-1'
    expect(resolveTrustedUrl(url)).toBe(url)
  })

  it('falls back to /notifications for a plain http url on a non-localhost host', () => {
    expect(resolveTrustedUrl('http://glocke.example.com/notifications/delivery-1')).toBe('/notifications')
  })

  it('falls back to /notifications for a non-http(s) scheme', () => {
    expect(resolveTrustedUrl('javascript:alert(1)')).toBe('/notifications')
    expect(resolveTrustedUrl('data:text/html,evil')).toBe('/notifications')
  })

  it('falls back to /notifications for an unparseable/malformed url', () => {
    expect(resolveTrustedUrl('not a url')).toBe('/notifications')
    expect(resolveTrustedUrl('   ')).toBe('/notifications')
  })

  it('falls back to /notifications for a bare relative path (no scheme/host)', () => {
    expect(resolveTrustedUrl('/notifications/delivery-1')).toBe('/notifications')
  })

  it('falls back to /notifications for an empty string, null, or undefined', () => {
    expect(resolveTrustedUrl('')).toBe('/notifications')
    expect(resolveTrustedUrl(null)).toBe('/notifications')
    expect(resolveTrustedUrl(undefined)).toBe('/notifications')
  })

  it('falls back to /notifications for a non-string candidate', () => {
    expect(resolveTrustedUrl(42)).toBe('/notifications')
    expect(resolveTrustedUrl({ url: 'https://glocke.example.com/x' })).toBe('/notifications')
  })

  it('honors a caller-supplied fallback path', () => {
    expect(resolveTrustedUrl('not a url', '/custom-fallback')).toBe('/custom-fallback')
  })
})
