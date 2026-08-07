import type {
  InboxRecord,
  NotificationPage,
  NotificationRecord,
  NotificationRepository,
} from '../../contracts.js'

export class MemoryNotificationRepository implements NotificationRepository {
  readonly inbox: InboxRecord[] = []
  readonly notifications: NotificationRecord[] = []
  failNextCompletion = false

  async acceptInbox(record: InboxRecord): Promise<'accepted' | 'duplicate' | 'conflict'> {
    const existing = this.inbox.find((candidate) => candidate.source === record.source && candidate.eventId === record.eventId)
    if (existing) return existing.payloadHash === record.payloadHash ? 'duplicate' : 'conflict'
    this.inbox.push(structuredClone(record))
    return 'accepted'
  }

  async claimPendingInbox(now: string, leaseUntil: string, leaseId: string): Promise<InboxRecord | null> {
    const record = this.inbox.find((candidate) => candidate.status === 'pending' || (
      candidate.status === 'processing' && candidate.leaseUntil !== null && candidate.leaseUntil < now
    ))
    if (!record) return null
    record.status = 'processing'
    record.leaseUntil = leaseUntil
    record.leaseId = leaseId
    return structuredClone(record)
  }

  async markInboxProcessed(source: string, eventId: string, leaseId: string, processedAt: string): Promise<boolean> {
    if (this.failNextCompletion) {
      this.failNextCompletion = false
      throw new Error('simulated completion failure')
    }
    const record = this.inbox.find((candidate) => candidate.source === source && candidate.eventId === eventId)
    if (!record || record.status !== 'processing' || record.leaseId !== leaseId || !record.leaseUntil || record.leaseUntil <= processedAt) return false
    record.status = 'processed'
    record.processedAt = processedAt
    record.leaseUntil = null
    record.leaseId = null
    return true
  }

  async createNotification(record: NotificationRecord, leaseId: string, now: string): Promise<'created' | 'duplicate' | 'stale'> {
    const claim = this.inbox.find((candidate) => (
      candidate.source === record.source && candidate.eventId === record.eventId &&
      candidate.status === 'processing' && candidate.leaseId === leaseId &&
      candidate.leaseUntil !== null && candidate.leaseUntil > now
    ))
    if (!claim) return 'stale'
    const existing = this.notifications.find(
      (candidate) => candidate.source === record.source && candidate.eventId === record.eventId && candidate.userId === record.userId,
    )
    if (existing) return 'duplicate'
    this.notifications.push(structuredClone(record))
    return 'created'
  }

  async listNotifications(userId: string, cursor: string | null, limit: number): Promise<NotificationPage> {
    const sorted = this.notifications
      .filter((notification) => notification.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    const start = cursor ? sorted.findIndex((notification) => notification.id === cursor) + 1 : 0
    const items = sorted.slice(start, start + limit)
    const nextCursor = start + limit < sorted.length ? items.at(-1)?.id ?? null : null
    return { items: structuredClone(items), nextCursor }
  }

  async unreadCount(userId: string): Promise<number> {
    return this.notifications.filter(
      (notification) => notification.userId === userId && notification.readAt === null,
    ).length
  }

  async markRead(
    userId: string,
    notificationId: string,
    readAt: string,
  ): Promise<NotificationRecord | null> {
    const notification = this.notifications.find(
      (candidate) => candidate.id === notificationId && candidate.userId === userId,
    )
    if (!notification) return null
    notification.readAt ??= readAt
    return structuredClone(notification)
  }

  async markAllRead(userId: string, readAt: string): Promise<number> {
    let updated = 0
    for (const notification of this.notifications) {
      if (notification.userId === userId && notification.readAt === null) {
        notification.readAt = readAt
        updated += 1
      }
    }
    return updated
  }

  async deleteNotification(userId: string, notificationId: string): Promise<boolean> {
    const index = this.notifications.findIndex(
      (notification) => notification.id === notificationId && notification.userId === userId,
    )
    if (index < 0) return false
    this.notifications.splice(index, 1)
    return true
  }

  recoverProcessing(): void {
    for (const record of this.inbox) {
      if (record.status === 'processing') {
        record.status = 'pending'
        record.leaseUntil = null
        record.leaseId = null
      }
    }
  }

  seedInbox(record: InboxRecord): void {
    this.inbox.push(structuredClone(record))
  }

  seedNotification(record: NotificationRecord): void {
    this.notifications.push(structuredClone(record))
  }
}
