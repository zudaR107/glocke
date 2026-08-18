import { verifyNotificationRequest } from '@zudar107/schloss-server-kit'
import { describe, expect, it, vi } from 'vitest'
import { createSchlusselRecipientResolver } from '../schlussel.js'

const SECRET = 'test-only-glocke-to-schlussel-secret'

describe('Schlussel recipient resolver', () => {
  it('signs the v1 GET as glocke with an exact empty body', async () => {
    const timeoutSignal = new AbortController().signal
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutSignal)
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = new URL(String(input))
      const headers = new Headers(init?.headers)
      expect(url.pathname).toBe('/internal/v1/notification-recipients/user%2Fone')
      expect(headers.get('X-Hof-Service')).toBe('glocke')
      expect(init?.signal).toBe(timeoutSignal)
      expect(verifyNotificationRequest({
        secret: SECRET,
        keyId: headers.get('X-Hof-Key-Id') ?? '',
        source: headers.get('X-Hof-Service') ?? '',
        timestamp: Number(headers.get('X-Hof-Timestamp')),
        method: 'GET',
        path: url.pathname,
        rawBody: '',
        signature: headers.get('X-Hof-Signature') ?? '',
        expectedKeyId: 'glocke-v1',
        expectedSource: 'glocke',
        maxSkewSeconds: 0,
        now: () => 1_786_104_000_000,
      })).toBe(true)
      return Response.json({ userId: 'user/one', notifyInApp: true, notifyBrowserPush: false })
    })
    const resolve = createSchlusselRecipientResolver({
      baseUrl: 'http://schlussel.test:4000', keyId: 'glocke-v1', secret: SECRET,
      fetchTimeoutMs: 1_234, fetch: fetchMock, now: () => 1_786_104_000_000,
    })

    await expect(resolve('user/one')).resolves.toEqual({ userId: 'user/one', notifyInApp: true, notifyBrowserPush: false })
    expect(timeoutSpy).toHaveBeenCalledWith(1_234)
    timeoutSpy.mockRestore()
  })

  it('maps an absent recipient to null', async () => {
    const resolve = createSchlusselRecipientResolver({
      baseUrl: 'http://schlussel.test:4000', keyId: 'glocke-v1', secret: SECRET,
      fetchTimeoutMs: 5_000,
      fetch: async () => new Response(null, { status: 404 }),
    })
    await expect(resolve('missing')).resolves.toBeNull()
  })
})
