import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

const registry = new OpenAPIRegistry()
registry.registerComponent('securitySchemes', 'bearerAuth', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
registry.registerComponent('securitySchemes', 'exportDelegationAuth', {
  type: 'http', scheme: 'bearer', bearerFormat: 'JWT',
  description: 'Schlüssel export delegation for Glocke with token_use=export, data:export scope, and hof-service:glocke audience.',
})
registry.registerComponent('securitySchemes', 'hofHmac', {
  type: 'apiKey', in: 'header', name: 'X-Hof-Signature',
  description: '64-character hexadecimal HMAC-SHA-256 over timestamp, uppercase method, path with query, SHA-256 of the exact body bytes, key id, and source (newline-delimited). The shared signer emits lowercase; verification is case-insensitive. Also requires X-Hof-Service, X-Hof-Key-Id, and X-Hof-Timestamp.',
})

const bearer = [{ bearerAuth: [] }]
const notification = z.object({
  id: z.string(), eventId: z.string(), source: z.string(), type: z.string(), title: z.string(), body: z.string(),
  actionUrl: z.string().nullable(), createdAt: z.iso.datetime(), readAt: z.iso.datetime().nullable(),
}).strict()
const exportResponse = z.object({
  version: z.literal('1'),
  service: z.literal('glocke'),
  exportedAt: z.iso.datetime(),
  data: z.object({ notifications: z.array(notification) }).strict(),
}).strict()
const json = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } })

registry.registerPath({
  method: 'get', path: '/notifications', tags: ['notifications'], summary: 'List caller-owned notifications', security: bearer,
  description: 'Returns only notifications owned by the subject of the verified JWT, newest first. The cursor is opaque.',
  request: { query: z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional() }) },
  responses: { 200: { description: 'Newest first', ...json(z.object({ items: z.array(notification), nextCursor: z.string().nullable() })) } },
})
registry.registerPath({
  method: 'get', path: '/notifications/unread-count', tags: ['notifications'], summary: 'Get unread count', security: bearer,
  responses: { 200: { description: 'Unread count', ...json(z.object({ count: z.number().int().nonnegative() })) } },
})
registry.registerPath({
  method: 'post', path: '/notifications/{id}/read', tags: ['notifications'], summary: 'Mark one notification read', security: bearer,
  request: { params: z.object({ id: z.string() }) }, responses: { 200: { description: 'Notification', ...json(notification) }, 404: { description: 'Not found' } },
})
registry.registerPath({
  method: 'post', path: '/notifications/read-all', tags: ['notifications'], summary: 'Mark all notifications read', security: bearer,
  responses: { 200: { description: 'Updated count', ...json(z.object({ updated: z.number().int().nonnegative() })) } },
})
registry.registerPath({
  method: 'delete', path: '/notifications/{id}', tags: ['notifications'], summary: 'Delete one notification', security: bearer,
  request: { params: z.object({ id: z.string() }) }, responses: { 204: { description: 'Deleted' }, 404: { description: 'Not found' } },
})
registry.registerPath({
  method: 'get', path: '/exports/me', tags: ['exports'], summary: 'Export caller-owned Glocke data',
  description: 'Synchronous direct Glocke JSON endpoint used by Settings and as an input to Schlüssel\'s separate asynchronous ZIP collector. Contains every subject-owned user-visible notification and read state without pagination, read when this request runs; it is not a cross-service point-in-time snapshot. Accepts an access token or a JWKS-verified delegation with the exact issuer, token_use=export, single hof-service:glocke audience, data:export scope, nonempty subject/job/token IDs, and a non-expired numeric expiry. Delegations are rejected by ordinary routes and the subject comes only from the verified principal. Inbox envelopes/hashes, suppressed events, worker leases, local user rows, credentials, runtime configuration, logs, other users, and other services are excluded. The response is private, no-store, and nosniff.',
  security: [{ bearerAuth: [] }, { exportDelegationAuth: [] }],
  responses: {
    200: { description: 'Versioned Glocke export envelope', ...json(exportResponse) },
    401: { description: 'Missing, invalid, expired, or incorrectly scoped token' },
  },
})
registry.registerPath({
  method: 'post', path: '/internal/v1/events', tags: ['internal'], summary: 'Accept a signed notification event',
  description: 'Authenticates the exact request body bytes and configured producer identity before durably writing the inbox. A new event returns 202, an exact byte-for-byte replay of the same source and event id returns 200, and identity reuse with different bytes returns 409. Producers may retry with the same stable event id; this is idempotent intake, not an exactly-once delivery guarantee.',
  security: [{ hofHmac: [] }],
  request: { body: { content: { 'application/json': { schema: z.object({
    version: z.literal('1'), id: z.uuid().describe('Non-nil event UUID'), type: z.string().min(1), source: z.string().min(1), occurredAt: z.iso.datetime(), correlationId: z.uuid().describe('Non-nil correlation UUID'),
    payload: z.union([
      z.object({ recipientId: z.string().min(1) }).strict().describe('Exact minimal payload for schlussel.security.password_changed.v1; only source schlussel may send that type.'),
      z.object({
        recipientId: z.string().min(1),
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(4_000),
        actionUrl: z.string().max(2_000).optional().describe('String beginning with / but not //, or beginning with https://.'),
      }).strict().describe('Payload for other configured event types.'),
    ]),
  }) } } } },
  responses: {
    202: { description: 'Durably accepted as a new inbox event' },
    200: { description: 'Exact duplicate; no second inbox row was created' },
    400: { description: 'Invalid JSON, envelope, source/type relationship, payload, or action URL' },
    401: { description: 'Missing, malformed, stale, or invalid signature' },
    403: { description: 'Source producer is not configured' },
    409: { description: 'The source and event id already exist with different exact body bytes' },
    413: { description: 'Request body exceeds the configured event limit' },
  },
})

export const openApiDocument = new OpenApiGeneratorV3(registry.definitions).generateDocument({
  openapi: '3.0.0',
  info: { title: 'Glocke API', version: '0.1.0', description: 'Durable, account-scoped Hof in-app notification center with authenticated, idempotent event intake. It does not claim exactly-once delivery.' },
  servers: [{ url: '/backend' }],
})
