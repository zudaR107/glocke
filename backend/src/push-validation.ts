const MAX_ENDPOINT_BYTES = 2_048
const MAX_KEY_BYTES = 256

export type PushSubscriptionValidationResult =
  | { valid: true; endpoint: string; p256dh: string; auth: string; expirationTime: number | null; providerHost: string }
  | { valid: false; reason: 'malformed-body' | 'insecure-endpoint' | 'endpoint-too-long' | 'key-too-long' | 'provider-not-allowed' }

// Server-side adaptation of schloss-ui's useUnreadNotifications.ts
// isNonPublicHost SSRF guard - defense in depth alongside the allowlist
// below, since the set of legitimate push-vendor hosts is small and fixed.
function isNonPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/, '').replace(/\]$/, '').replace(/\.$/, '')
  if (!host.includes('.') && !host.includes(':')) return true
  if (['.internal', '.lan', '.local', '.localdomain', '.localhost', '.home', '.home.arpa'].some((suffix) => host.endsWith(suffix))) return true

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number) as [number, number]
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || a >= 224
  }

  if (host.includes(':')) {
    return host === '::'
      || host === '::1'
      || host.startsWith('::ffff:')
      || /^f[cd]/.test(host)
      || /^fe[89ab]/.test(host)
      || host.startsWith('ff')
  }
  return false
}

function isAllowedProviderHost(host: string, allowedProviderHosts: readonly string[]): boolean {
  return allowedProviderHosts.some((entry) => (entry.startsWith('.') ? host.endsWith(entry) : host === entry))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validatePushSubscriptionInput(
  body: unknown,
  allowedProviderHosts: readonly string[],
): PushSubscriptionValidationResult {
  if (!isPlainObject(body)) return { valid: false, reason: 'malformed-body' }
  const allowedTopLevelKeys = new Set(['endpoint', 'keys', 'expirationTime'])
  if (Object.keys(body).some((key) => !allowedTopLevelKeys.has(key))) return { valid: false, reason: 'malformed-body' }

  const { endpoint, keys, expirationTime } = body
  if (typeof endpoint !== 'string' || endpoint.length === 0) return { valid: false, reason: 'malformed-body' }
  if (!isPlainObject(keys)) return { valid: false, reason: 'malformed-body' }
  const { p256dh, auth } = keys
  if (typeof p256dh !== 'string' || p256dh.length === 0) return { valid: false, reason: 'malformed-body' }
  if (typeof auth !== 'string' || auth.length === 0) return { valid: false, reason: 'malformed-body' }
  if (expirationTime !== undefined && typeof expirationTime !== 'number') return { valid: false, reason: 'malformed-body' }

  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return { valid: false, reason: 'malformed-body' }
  }
  if (url.protocol !== 'https:' || url.username || url.password) return { valid: false, reason: 'insecure-endpoint' }
  if (isNonPublicHost(url.hostname)) return { valid: false, reason: 'insecure-endpoint' }
  if (Buffer.byteLength(endpoint) > MAX_ENDPOINT_BYTES) return { valid: false, reason: 'endpoint-too-long' }

  const providerHost = url.hostname.toLowerCase()
  if (!isAllowedProviderHost(providerHost, allowedProviderHosts)) return { valid: false, reason: 'provider-not-allowed' }

  if (Buffer.byteLength(p256dh) > MAX_KEY_BYTES || Buffer.byteLength(auth) > MAX_KEY_BYTES) {
    return { valid: false, reason: 'key-too-long' }
  }

  return {
    valid: true,
    endpoint,
    p256dh,
    auth,
    expirationTime: expirationTime ?? null,
    providerHost,
  }
}
