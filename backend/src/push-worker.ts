import { calculateBackoffDelay, classifyNotificationResponse } from '@zudar107/schloss-server-kit'
import type { PushRepository } from './push-repository.js'
import type { ResolveRecipient } from './contracts.js'

export interface PushAdapterSendArgs {
  subscription: { endpoint: string; p256dh: string; auth: string }
  payload: { id: string; text: string; url: string }
  vapid: { publicKey: string; privateKey: string; subject: string }
  timeoutMs: number
}

export type PushAdapterSendResult =
  | { outcome: 'sent'; status: number; retryAfterMs?: number }
  | { outcome: 'timeout' }
  | { outcome: 'network-error'; message: string }

export interface PushAdapter {
  send(args: PushAdapterSendArgs): Promise<PushAdapterSendResult>
}

export interface CreatePushWorkerOptions {
  repository: PushRepository
  resolveRecipient: ResolveRecipient
  adapter: PushAdapter
  vapid: { publicKey: string; privateKey: string; subject: string }
  now?: () => Date
  createLeaseId?: () => string
  random?: () => number
  leaseMs?: number
  fetchTimeoutMs?: number
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  intervalMs?: number
  stopTimeoutMs?: number
}

export type DeliverOneResult = 'idle' | 'delivered' | 'suppressed' | 'retry' | 'permanent'

export interface PushWorker {
  deliverOne(): Promise<DeliverOneResult>
  reconcile(existingUserIds: ReadonlySet<string>): Promise<number>
  start(): void
  stop(): Promise<void>
}

const GENERIC_PUSH_TEXT = 'У вас новое уведомление'

export function createPushWorker(options: CreatePushWorkerOptions): PushWorker {
  const now = options.now ?? (() => new Date())
  const createLeaseId = options.createLeaseId ?? (() => crypto.randomUUID())
  const random = options.random ?? Math.random
  const leaseMs = options.leaseMs ?? 30_000
  const fetchTimeoutMs = options.fetchTimeoutMs ?? 10_000
  const maxAttempts = options.maxAttempts ?? 8
  const baseDelayMs = options.baseDelayMs ?? 1_000
  const maxDelayMs = options.maxDelayMs ?? 6 * 60 * 60_000
  const intervalMs = options.intervalMs ?? 1_000
  const stopTimeoutMs = options.stopTimeoutMs ?? 5_000

  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = true
  let inFlight: Promise<unknown> | null = null

  async function retryOrPermanent(
    deliveryId: string, leaseId: string, attempts: number,
    lastStatus: number | null, lastError: string, delayMs: number,
  ): Promise<'retry' | 'permanent'> {
    if (attempts >= maxAttempts) {
      await options.repository.markPermanent(deliveryId, leaseId, attempts, lastStatus, lastError)
      return 'permanent'
    }
    const nextAttemptAt = new Date(now().getTime() + delayMs).toISOString()
    await options.repository.markRetry(deliveryId, leaseId, attempts, nextAttemptAt, lastStatus, lastError)
    return 'retry'
  }

  return {
    async deliverOne() {
      const claimedAt = now()
      const leaseId = createLeaseId()
      const delivery = await options.repository.claimPendingDelivery(
        claimedAt.toISOString(),
        new Date(claimedAt.getTime() + leaseMs).toISOString(),
        leaseId,
      )
      if (!delivery) return 'idle'

      const subscription = await options.repository.findSubscriptionById(delivery.subscriptionId)
      if (!subscription) {
        await options.repository.markSuppressed(delivery.id, leaseId)
        return 'suppressed'
      }

      const recipient = await options.resolveRecipient(delivery.userId)
      if (!recipient?.notifyBrowserPush) {
        await options.repository.markSuppressed(delivery.id, leaseId)
        return 'suppressed'
      }

      const result = await options.adapter.send({
        subscription: { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth },
        payload: { id: delivery.id, text: GENERIC_PUSH_TEXT, url: delivery.destinationUrl },
        vapid: options.vapid,
        timeoutMs: fetchTimeoutMs,
      })

      if (result.outcome === 'sent' && (result.status === 404 || result.status === 410)) {
        await options.repository.deleteSubscription(delivery.userId, delivery.subscriptionId)
        return 'permanent'
      }

      if (result.outcome === 'sent') {
        const classification = classifyNotificationResponse(result.status)
        if (classification === 'success') {
          const deliveredAt = now().toISOString()
          await options.repository.markDelivered(delivery.id, leaseId, deliveredAt)
          await options.repository.touchSubscriptionSuccess(subscription.id, deliveredAt)
          return 'delivered'
        }
        if (classification === 'permanent') {
          await options.repository.markPermanent(delivery.id, leaseId, delivery.attempts + 1, result.status, `HTTP ${result.status}`)
          return 'permanent'
        }
        const delayMs = result.retryAfterMs !== undefined
          ? Math.min(result.retryAfterMs, maxDelayMs)
          : calculateBackoffDelay({ attempt: delivery.attempts, baseDelayMs, maxDelayMs, random })
        return retryOrPermanent(delivery.id, leaseId, delivery.attempts + 1, result.status, `HTTP ${result.status}`, delayMs)
      }

      if (result.outcome === 'timeout') {
        const delayMs = calculateBackoffDelay({ attempt: delivery.attempts, baseDelayMs, maxDelayMs, random })
        return retryOrPermanent(delivery.id, leaseId, delivery.attempts + 1, null, 'Request timed out', delayMs)
      }

      const delayMs = calculateBackoffDelay({ attempt: delivery.attempts, baseDelayMs, maxDelayMs, random })
      return retryOrPermanent(delivery.id, leaseId, delivery.attempts + 1, null, 'Network error', delayMs)
    },

    async reconcile(existingUserIds) {
      return options.repository.deleteOrphanedSubscriptions(existingUserIds)
    },

    start() {
      stopped = false
      const tick = () => {
        if (stopped) return
        inFlight = this.deliverOne().catch(() => 'idle' as const).finally(() => {
          if (!stopped) timer = setTimeout(tick, intervalMs)
        })
      }
      timer = setTimeout(tick, intervalMs)
    },

    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      if (inFlight) {
        await Promise.race([
          inFlight,
          new Promise((resolve) => setTimeout(resolve, stopTimeoutMs)),
        ])
      }
    },
  }
}
