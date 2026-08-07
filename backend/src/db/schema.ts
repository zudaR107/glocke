import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
})

export const inboxEvents = sqliteTable('inbox_events', {
  source: text('source').notNull(),
  eventId: text('event_id').notNull(),
  userId: text('user_id').notNull(),
  payloadHash: text('payload_hash').notNull(),
  envelope: text('envelope').notNull(),
  status: text('status', { enum: ['pending', 'processing', 'processed'] }).notNull(),
  acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }).notNull(),
  processedAt: integer('processed_at', { mode: 'timestamp_ms' }),
  leaseUntil: integer('lease_until', { mode: 'timestamp_ms' }),
  leaseId: text('lease_id'),
}, (table) => [
  primaryKey({ columns: [table.source, table.eventId] }),
  index('inbox_claim_idx').on(table.status, table.leaseUntil, table.acceptedAt),
])

export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  eventId: text('event_id').notNull(),
  userId: text('user_id').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  actionUrl: text('action_url'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  readAt: integer('read_at', { mode: 'timestamp_ms' }),
}, (table) => [
  uniqueIndex('notifications_event_recipient_unique').on(table.source, table.eventId, table.userId),
  index('notifications_user_created_idx').on(table.userId, table.createdAt, table.id),
  index('notifications_user_unread_idx').on(table.userId, table.readAt),
])
