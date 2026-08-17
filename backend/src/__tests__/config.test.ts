import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createCorsMiddleware } from '@zudar107/schloss-server-kit'
import { Hono } from 'hono'
import { loadConfig } from '../config.js'

const LOCAL_FRONTEND_ORIGINS = [
  'https://localhost',
  'https://auth.localhost',
  'https://kuvert.localhost',
  'https://tafel.localhost',
  'https://zettel.localhost',
  'https://glocke.localhost',
]

function validEnv(): NodeJS.ProcessEnv {
  return {
    PORT: '3004', DATABASE_PATH: '/tmp/glocke.db', SCHLUSSEL_JWKS_URL: 'http://schlussel/jwks',
    JWT_ISSUER: 'schlussel', SCHLUSSEL_INTERNAL_URL: 'http://schlussel:4000',
    KUVERT_ORIGIN: 'https://kuvert.example.test', TAFEL_ORIGIN: 'https://tafel.example.test',
    GLOCKE_TO_SCHLUSSEL_HMAC_KEY_ID: 'glocke-v1',
    GLOCKE_TO_SCHLUSSEL_HMAC_SECRET: 'glocke-to-schlussel-secret-32-bytes',
    ALLOWED_ORIGINS: 'https://glocke.localhost', GLOCKE_EVENT_SOURCES: 'schlussel,kuvert,tafel,zettel',
    GLOCKE_SOURCE_KEY_ID_SCHLUSSEL: 'schlussel-v1',
    GLOCKE_SOURCE_SECRET_SCHLUSSEL: 'schlussel-to-glocke-secret-32-bytes',
    GLOCKE_SOURCE_KEY_ID_KUVERT: 'kuvert-v1',
    GLOCKE_SOURCE_SECRET_KUVERT: 'kuvert-to-glocke-secret-with-32-bytes',
    GLOCKE_SOURCE_KEY_ID_TAFEL: 'tafel-v1',
    GLOCKE_SOURCE_SECRET_TAFEL: 'tafel-to-glocke-secret-with-32-bytes',
    GLOCKE_SOURCE_KEY_ID_ZETTEL: 'zettel-v1',
    GLOCKE_SOURCE_SECRET_ZETTEL: 'zettel-to-glocke-secret-with-32-bytes',
  }
}

describe('runtime configuration', () => {
  it('loads complete producer and recipient-call credentials', () => {
    expect(loadConfig(validEnv())).toMatchObject({
      port: 3004, schlusselKeyId: 'glocke-v1', recipientFetchTimeoutMs: 5_000,
      workerLeaseMs: 30_000,
      sourceOrigins: {
        kuvert: 'https://kuvert.example.test',
        tafel: 'https://tafel.example.test',
      },
      producers: {
        schlussel: { keyId: 'schlussel-v1' },
        kuvert: { keyId: 'kuvert-v1' },
        tafel: { keyId: 'tafel-v1' },
        zettel: { keyId: 'zettel-v1' },
      },
    })
  })

  it.each([
    ['PORT', 'NaN'],
    ['GLOCKE_MAX_EVENT_BYTES', '-1'],
    ['GLOCKE_RECIPIENT_FETCH_TIMEOUT_MS', '1.5'],
    ['GLOCKE_RECIPIENT_FETCH_TIMEOUT_MS', 'Infinity'],
    ['GLOCKE_WORKER_LEASE_MS', '10000'],
    ['GLOCKE_EVENT_SOURCES', 'Schlussel'],
    ['GLOCKE_SOURCE_KEY_ID_SCHLUSSEL', 'bad key'],
    ['GLOCKE_SOURCE_SECRET_SCHLUSSEL', 'short'],
    ['GLOCKE_TO_SCHLUSSEL_HMAC_SECRET', 'short'],
    ['SCHLUSSEL_INTERNAL_URL', 'not-a-url'],
    ['SCHLUSSEL_INTERNAL_URL', 'http://user:password@schlussel:4000'],
    ['SCHLUSSEL_INTERNAL_URL', 'http://schlussel:4000/api'],
  ])('fails closed for invalid %s', (name, value) => {
    expect(() => loadConfig({ ...validEnv(), [name]: value })).toThrow()
  })

  it.each([
    ['equal to the timeout', '5000', '5000'],
    ['less than ten seconds of headroom', '5000', '14999'],
  ])('rejects a worker lease %s', (_case, timeout, lease) => {
    expect(() => loadConfig({
      ...validEnv(),
      GLOCKE_RECIPIENT_FETCH_TIMEOUT_MS: timeout,
      GLOCKE_WORKER_LEASE_MS: lease,
    })).toThrow(/at least 10000ms longer/)
  })

  it('accepts exactly ten seconds of lease headroom', () => {
    expect(loadConfig({
      ...validEnv(),
      GLOCKE_RECIPIENT_FETCH_TIMEOUT_MS: '5000',
      GLOCKE_WORKER_LEASE_MS: '15000',
    }).workerLeaseMs).toBe(15_000)
  })

  it('rejects reuse of a producer secret for the outbound credential', () => {
    const env = validEnv()
    env['GLOCKE_TO_SCHLUSSEL_HMAC_SECRET'] = env['GLOCKE_SOURCE_SECRET_SCHLUSSEL']
    expect(() => loadConfig(env)).toThrow(/distinct secret/)
  })

  it('rejects secret reuse between producers', () => {
    const env = {
      ...validEnv(),
      GLOCKE_EVENT_SOURCES: 'schlussel,tafel',
      GLOCKE_SOURCE_KEY_ID_TAFEL: 'tafel-v1',
      GLOCKE_SOURCE_SECRET_TAFEL: validEnv()['GLOCKE_SOURCE_SECRET_SCHLUSSEL'],
    }
    expect(() => loadConfig(env)).toThrow(/distinct secret/)
  })

  it('rejects a configured producer absent from the central event registry', () => {
    expect(() => loadConfig({
      ...validEnv(),
      GLOCKE_EVENT_SOURCES: 'schlussel,unknown',
      GLOCKE_SOURCE_KEY_ID_UNKNOWN: 'unknown-v1',
      GLOCKE_SOURCE_SECRET_UNKNOWN: 'unknown-to-glocke-secret-with-32-bytes',
    })).toThrow(/registry|unsupported|unknown/i)
  })

  it.each([
    ['KUVERT_ORIGIN', 'not-a-url'],
    ['KUVERT_ORIGIN', 'http://kuvert.example.test'],
    ['KUVERT_ORIGIN', 'https://user:password@kuvert.example.test'],
    ['TAFEL_ORIGIN', 'http://tafel.example.test'],
    ['TAFEL_ORIGIN', 'https://tafel.example.test/tasks'],
    ['TAFEL_ORIGIN', 'https://tafel.example.test?view=tasks'],
  ])('rejects malformed or non-HTTPS action origin %s=%s', (name, value) => {
    expect(() => loadConfig({ ...validEnv(), [name]: value })).toThrow(/origin|HTTPS/i)
  })

  it('accepts HTTP action origins only for direct localhost development', () => {
    expect(loadConfig({
      ...validEnv(),
      KUVERT_ORIGIN: 'http://localhost:5174',
      TAFEL_ORIGIN: 'http://127.0.0.1:5175',
    }).sourceOrigins).toEqual({
      kuvert: 'http://localhost:5174',
      tafel: 'http://127.0.0.1:5175',
    })
  })

  it('maps Tor public URL variables into backend action origins in Compose', () => {
    const compose = readFileSync(new URL('../../../docker-compose.yml', import.meta.url), 'utf8')
    expect(compose).toContain('KUVERT_ORIGIN: ${KUVERT_URL:-https://kuvert.localhost}')
    expect(compose).toContain('TAFEL_ORIGIN: ${TAFEL_URL:-https://tafel.localhost}')
  })

  it('configures exact CORS access for every local Hof frontend', async () => {
    const compose = readFileSync(new URL('../../../docker-compose.yml', import.meta.url), 'utf8')
    const configuredDefault = compose.match(/ALLOWED_ORIGINS: \$\{GLOCKE_ALLOWED_ORIGINS:-([^}]+)}/)?.[1]
    expect(configuredDefault).toBeDefined()

    const config = loadConfig({ ...validEnv(), ALLOWED_ORIGINS: configuredDefault })
    expect(config.allowedOrigins).toEqual(LOCAL_FRONTEND_ORIGINS)

    const app = new Hono()
    app.use('*', createCorsMiddleware({ allowedOrigins: config.allowedOrigins }))
    app.get('/notifications/unread-count', (context) => context.json({ count: 0 }))

    for (const origin of LOCAL_FRONTEND_ORIGINS) {
      const response = await app.request('/notifications/unread-count', { headers: { Origin: origin } })
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
      expect(response.headers.get('Vary')).toContain('Origin')
    }

    const rejected = await app.request('/notifications/unread-count', {
      headers: { Origin: 'https://unknown.localhost' },
    })
    expect(rejected.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('allows Authorization in notification preflight responses and varies by Origin', async () => {
    const app = new Hono()
    app.use('*', createCorsMiddleware({ allowedOrigins: LOCAL_FRONTEND_ORIGINS }))
    app.get('/notifications/unread-count', (context) => context.json({ count: 0 }))

    const response = await app.request('/notifications/unread-count', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://tafel.localhost',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization',
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://tafel.localhost')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
    expect(response.headers.get('Vary')).toContain('Origin')
  })
})
