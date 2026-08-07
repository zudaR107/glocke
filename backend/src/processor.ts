import type { NotificationRepository, ResolveRecipient } from './contracts.js'

export interface Processor {
  processNext(): Promise<'processed' | 'idle'>
}

export interface CreateProcessorOptions {
  repository: NotificationRepository
  resolveRecipient: ResolveRecipient
  now?: () => Date
  createId?: () => string
  createLeaseId?: () => string
  leaseMs?: number
}

export function createProcessor(options: CreateProcessorOptions): Processor {
  const now = options.now ?? (() => new Date())
  const createId = options.createId ?? (() => crypto.randomUUID())
  const createLeaseId = options.createLeaseId ?? (() => crypto.randomUUID())
  const leaseMs = options.leaseMs ?? 30_000

  return {
    async processNext() {
      const claimedAt = now()
      const leaseId = createLeaseId()
      const event = await options.repository.claimPendingInbox(
        claimedAt.toISOString(),
        new Date(claimedAt.getTime() + leaseMs).toISOString(),
        leaseId,
      )
      if (!event) return 'idle'

      const recipient = await options.resolveRecipient(event.userId)
      const processedAt = now().toISOString()
      if (recipient?.notifyInApp) {
        const payload = renderNotification(event.envelope)
        const result = await options.repository.createNotification({
          id: createId(),
          eventId: event.eventId,
          userId: event.userId,
          source: event.source,
          type: event.envelope.type,
          ...payload,
          createdAt: event.envelope.occurredAt,
          readAt: null,
        }, leaseId, processedAt)
        if (result === 'stale') return 'idle'
      }
      return await options.repository.markInboxProcessed(
        event.source, event.eventId, leaseId, processedAt,
      ) ? 'processed' : 'idle'
    },
  }
}

function renderNotification(envelope: import('./contracts.js').EventEnvelope): Pick<
  import('./contracts.js').NotificationRecord, 'title' | 'body' | 'actionUrl'
> {
  if (envelope.type === 'schlussel.security.password_changed.v1') {
    return {
      title: 'Пароль изменён',
      body: 'Пароль вашей учётной записи был изменён.',
      actionUrl: '/settings',
    }
  }
  if (!envelope.payload.title || !envelope.payload.body) {
    throw new Error(`Unsupported notification event type: ${envelope.type}`)
  }
  return {
    title: envelope.payload.title,
    body: envelope.payload.body,
    actionUrl: envelope.payload.actionUrl ?? null,
  }
}
