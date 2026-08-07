export interface EventEnvelope {
  version: '1'
  id: string
  source: string
  type: string
  occurredAt: string
  correlationId: string
  payload: EventPayload
}

// Shape varies per registered event type (see event-registry.ts) - only
// recipientId is common to all of them. Producers can never supply
// title/body/actionUrl; every payload schema in the registry is
// `.strict()` and rejects them outright.
export interface EventPayload {
  recipientId: string
  [key: string]: unknown
}

export interface InboxRecord {
  eventId: string
  source: string
  userId: string
  payloadHash: string
  envelope: EventEnvelope
  status: 'pending' | 'processing' | 'processed'
  acceptedAt: string
  processedAt: string | null
  leaseUntil: string | null
  leaseId: string | null
}

export interface NotificationRecord {
  id: string
  eventId: string
  userId: string
  source: string
  type: string
  title: string
  body: string
  actionUrl: string | null
  createdAt: string
  readAt: string | null
}

export interface NotificationPage {
  items: NotificationRecord[]
  nextCursor: string | null
}

export interface NotificationRepository {
  acceptInbox(record: InboxRecord): Promise<'accepted' | 'duplicate' | 'conflict'>
  claimPendingInbox(now: string, leaseUntil: string, leaseId: string): Promise<InboxRecord | null>
  markInboxProcessed(source: string, eventId: string, leaseId: string, processedAt: string): Promise<boolean>
  createNotification(record: NotificationRecord, leaseId: string, now: string): Promise<'created' | 'duplicate' | 'stale'>
  listNotifications(userId: string, cursor: string | null, limit: number): Promise<NotificationPage>
  exportNotifications(userId: string): Promise<NotificationRecord[]>
  unreadCount(userId: string): Promise<number>
  markRead(userId: string, notificationId: string, readAt: string): Promise<NotificationRecord | null>
  markAllRead(userId: string, readAt: string): Promise<number>
  deleteNotification(userId: string, notificationId: string): Promise<boolean>
}

export interface Recipient {
  userId: string
  notifyInApp: boolean
}

export type ResolveRecipient = (userId: string) => Promise<Recipient | null>
export type Authenticate = (request: Request) => Promise<string | null>
