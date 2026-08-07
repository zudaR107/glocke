import { signNotificationRequest } from '@zudar107/schloss-server-kit'
import type { ResolveRecipient } from './contracts.js'

interface ResolverOptions {
  baseUrl: string
  keyId: string
  secret: string
  fetchTimeoutMs: number
  fetch?: typeof fetch
  now?: () => number
}

export function createSchlusselRecipientResolver(options: ResolverOptions): ResolveRecipient {
  const request = options.fetch ?? fetch
  const now = options.now ?? Date.now

  return async (userId) => {
    const path = `/internal/v1/notification-recipients/${encodeURIComponent(userId)}`
    const timestamp = Math.floor(now() / 1_000)
    const signature = signNotificationRequest({
      secret: options.secret,
      keyId: options.keyId,
      source: 'glocke',
      timestamp,
      method: 'GET',
      path,
      rawBody: '',
    })
    const response = await request(new URL(path, options.baseUrl), {
      headers: {
        'X-Hof-Service': 'glocke',
        'X-Hof-Key-Id': options.keyId,
        'X-Hof-Timestamp': timestamp.toString(),
        'X-Hof-Signature': signature,
      },
      signal: AbortSignal.timeout(options.fetchTimeoutMs),
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Schlussel recipient lookup failed with ${response.status}`)
    const body = await response.json() as Record<string, unknown>
    if (body['userId'] !== userId || typeof body['notifyInApp'] !== 'boolean') {
      throw new Error('Schlussel returned an invalid recipient')
    }
    return { userId, notifyInApp: body['notifyInApp'] }
  }
}
