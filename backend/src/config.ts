import type { ProducerCredential } from './app.js'

export interface RuntimeConfig {
  port: number
  databasePath: string
  jwksUrl: string
  jwtIssuer: string
  schlusselInternalUrl: string
  schlusselKeyId: string
  schlusselSecret: string
  allowedOrigins: string[]
  producers: Record<string, ProducerCredential>
  maxSkewSeconds: number
  maxEventBytes: number
  workerIntervalMs: number
  workerLeaseMs: number
  recipientFetchTimeoutMs: number
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (!value || !value.trim()) throw new Error(`${name} is required`)
  if (value !== value.trim()) throw new Error(`${name} must not have leading or trailing whitespace`)
  return value
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim() || String(fallback)
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer between ${min} and ${max}`)
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

function url(value: string, name: string): string {
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new Error(`${name} must be an absolute HTTP(S) URL`) }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error(`${name} must be an absolute HTTP(S) URL`)
  }
  return parsed.toString().replace(/\/$/, '')
}

function origin(value: string, name: string): string {
  const parsed = new URL(url(value, name))
  if ((parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash) {
    throw new Error(`${name} must be an HTTP(S) origin without credentials or a path`)
  }
  return parsed.origin
}

function keyId(value: string, name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error(`${name} is invalid`)
  return value
}

function secret(value: string, name: string): string {
  if (Buffer.byteLength(value) < 32) throw new Error(`${name} must be at least 32 bytes`)
  return value
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const sources = required(env, 'GLOCKE_EVENT_SOURCES').split(',').map((value) => value.trim())
  if (sources.some((source) => !/^[a-z][a-z0-9-]{0,63}$/.test(source)) || new Set(sources).size !== sources.length) {
    throw new Error('GLOCKE_EVENT_SOURCES must contain unique lowercase service names')
  }
  const producers = Object.fromEntries(sources.map((source) => {
    const suffix = source.toUpperCase().replaceAll('-', '_')
    return [source, {
      keyId: keyId(required(env, `GLOCKE_SOURCE_KEY_ID_${suffix}`), `GLOCKE_SOURCE_KEY_ID_${suffix}`),
      secret: secret(required(env, `GLOCKE_SOURCE_SECRET_${suffix}`), `GLOCKE_SOURCE_SECRET_${suffix}`),
    }]
  }))
  const origins = required(env, 'ALLOWED_ORIGINS').split(',').map((value) => origin(value.trim(), 'ALLOWED_ORIGINS'))
  const schlusselSecret = secret(required(env, 'GLOCKE_TO_SCHLUSSEL_HMAC_SECRET'), 'GLOCKE_TO_SCHLUSSEL_HMAC_SECRET')
  const configuredSecrets = [schlusselSecret, ...Object.values(producers).map((credential) => credential.secret)]
  if (new Set(configuredSecrets).size !== configuredSecrets.length) {
    throw new Error('Every producer and Glocke-to-Schlussel HMAC credential must use a distinct secret')
  }
  const recipientFetchTimeoutMs = integer(
    env, 'GLOCKE_RECIPIENT_FETCH_TIMEOUT_MS', 5_000, 1, 3_590_000,
  )
  const workerLeaseMs = integer(env, 'GLOCKE_WORKER_LEASE_MS', 30_000, 1, 3_600_000)
  if (workerLeaseMs - recipientFetchTimeoutMs < 10_000) {
    throw new Error('GLOCKE_WORKER_LEASE_MS must be at least 10000ms longer than GLOCKE_RECIPIENT_FETCH_TIMEOUT_MS')
  }

  return {
    port: integer(env, 'PORT', 3004, 1, 65_535),
    databasePath: required(env, 'DATABASE_PATH'),
    jwksUrl: url(required(env, 'SCHLUSSEL_JWKS_URL'), 'SCHLUSSEL_JWKS_URL'),
    jwtIssuer: required(env, 'JWT_ISSUER'),
    schlusselInternalUrl: origin(required(env, 'SCHLUSSEL_INTERNAL_URL'), 'SCHLUSSEL_INTERNAL_URL'),
    schlusselKeyId: keyId(required(env, 'GLOCKE_TO_SCHLUSSEL_HMAC_KEY_ID'), 'GLOCKE_TO_SCHLUSSEL_HMAC_KEY_ID'),
    schlusselSecret,
    allowedOrigins: origins,
    producers,
    maxSkewSeconds: integer(env, 'GLOCKE_MAX_SKEW_SECONDS', 300, 0, 86_400),
    maxEventBytes: integer(env, 'GLOCKE_MAX_EVENT_BYTES', 65_536, 1, 1_048_576),
    workerIntervalMs: integer(env, 'GLOCKE_WORKER_INTERVAL_MS', 1_000, 10, 3_600_000),
    workerLeaseMs,
    recipientFetchTimeoutMs,
  }
}
