import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Bell } from 'lucide-react'
import { Button } from '@zudar107/schloss-ui'
import { api, ApiError } from '../../lib/api'
import { urlBase64ToUint8Array } from '../../lib/push/vapidKey'

interface PushSubscriptionSummary {
  id: string
  providerHost: string
  createdAt: string
  lastSuccessAt: string | null
}

interface PushStatus {
  available: boolean
  notifyBrowserPush: boolean
  vapidPublicKey: string | null
  vapidKeyId: string | null
  subscriptions: PushSubscriptionSummary[]
}

type Capability = 'unsupported' | 'insecure' | 'ok'
type StatusState = 'loading' | 'error' | PushStatus
type ActionErrorKind = 'enable-error' | 'repair-conflict' | 'repair-partial'

function computeCapability(): Capability {
  const hasApis = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window
  if (!hasApis) return 'unsupported'
  if (typeof window === 'undefined' || !window.isSecureContext) return 'insecure'
  return 'ok'
}

function currentPermission(): NotificationPermission {
  return typeof window !== 'undefined' && 'Notification' in window
    ? (window.Notification as unknown as { permission: NotificationPermission }).permission
    : 'default'
}

function StatusRegion({ label, children }: { label: string; children: ReactNode }) {
  return <div role="status" aria-label={label} className="push-settings-region">{children}</div>
}

function AlertRegion({ label, children }: { label: string; children: ReactNode }) {
  return <div role="alert" aria-label={label} className="push-settings-region push-settings-region--alert">{children}</div>
}

export function BrowserPushSettings() {
  const [capability] = useState<Capability>(computeCapability)
  const [statusState, setStatusState] = useState<StatusState>('loading')
  const [permission, setPermission] = useState<NotificationPermission>(currentPermission)
  const [actionError, setActionError] = useState<ActionErrorKind | null>(null)

  const busyRef = useRef(false)
  const subscriptionRef = useRef<{ unsubscribe: () => Promise<unknown> } | null>(null)
  const retryRef = useRef<() => void>(() => {})

  const fetchStatus = useCallback(async () => {
    setStatusState('loading')
    try {
      const data = await api.get<PushStatus>('/notifications/push/status')
      setStatusState(data)
    } catch {
      setStatusState('error')
    }
  }, [])

  useEffect(() => {
    if (capability !== 'ok') return
    void fetchStatus()
  }, [capability, fetchStatus])

  async function runEnableFlow(status: PushStatus) {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    const requested = await Notification.requestPermission()
    setPermission(requested)
    if (requested !== 'granted') return
    if (!status.vapidPublicKey) throw new Error('Browser push is not configured')
    const applicationServerKey = urlBase64ToUint8Array(status.vapidPublicKey)
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
    subscriptionRef.current = subscription
    const created = await api.put<PushSubscriptionSummary>('/notifications/push/subscriptions', subscription.toJSON())
    setStatusState((prev) => (prev === 'loading' || prev === 'error' ? prev : { ...prev, subscriptions: [...prev.subscriptions, created] }))
  }

  async function handleEnable() {
    if (busyRef.current || typeof statusState === 'string') return
    const status = statusState
    busyRef.current = true
    retryRef.current = () => void handleEnable()
    setActionError(null)
    try {
      await runEnableFlow(status)
    } catch (error) {
      setActionError(error instanceof ApiError && error.status === 409 ? 'repair-conflict' : 'enable-error')
    } finally {
      busyRef.current = false
    }
  }

  async function handleRepairConflict() {
    if (busyRef.current || typeof statusState === 'string') return
    const status = statusState
    busyRef.current = true
    retryRef.current = () => void handleRepairConflict()
    try {
      await subscriptionRef.current?.unsubscribe()
      setActionError(null)
      await runEnableFlow(status)
    } catch {
      setActionError('repair-partial')
    } finally {
      busyRef.current = false
    }
  }

  async function handleDisable() {
    if (busyRef.current || typeof statusState === 'string') return
    const status = statusState
    const subscriptionId = status.subscriptions[0]?.id
    busyRef.current = true
    retryRef.current = () => void handleDisable()
    setActionError(null)

    let deleted = false
    try {
      if (subscriptionId) {
        await api.delete(`/notifications/push/subscriptions/${subscriptionId}`)
        deleted = true
      }
    } catch { /* handled by the deleted/unsubscribed check below */ }

    let unsubscribed = false
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) await subscription.unsubscribe()
      unsubscribed = true
    } catch { /* handled by the deleted/unsubscribed check below */ }

    busyRef.current = false
    if (deleted && unsubscribed) {
      setStatusState((prev) => (prev === 'loading' || prev === 'error' ? prev : { ...prev, subscriptions: [] }))
    } else {
      setActionError('repair-partial')
    }
  }

  if (capability === 'unsupported') {
    return <StatusRegion label="push-unsupported">Этот браузер не поддерживает push-уведомления.</StatusRegion>
  }
  if (capability === 'insecure') {
    return <StatusRegion label="push-insecure-context">Push-уведомления доступны только по HTTPS.</StatusRegion>
  }
  if (statusState === 'loading') {
    return <StatusRegion label="push-status-loading">Загрузка статуса push-уведомлений…</StatusRegion>
  }
  if (statusState === 'error') {
    return (
      <AlertRegion label="push-status-error">
        <p>Не удалось загрузить статус push-уведомлений.</p>
        <Button variant="secondary" onClick={() => void fetchStatus()}>Повторить</Button>
      </AlertRegion>
    )
  }

  const status = statusState

  if (actionError === 'repair-conflict') {
    return (
      <AlertRegion label="push-repair-conflict">
        <p>Этот браузер уже зарегистрирован для другого аккаунта.</p>
        <Button variant="secondary" onClick={() => void handleRepairConflict()}>Восстановить</Button>
      </AlertRegion>
    )
  }
  if (actionError === 'repair-partial') {
    return (
      <AlertRegion label="push-repair-partial">
        <p>Не удалось завершить действие полностью — состояние требует восстановления.</p>
        <Button variant="secondary" onClick={() => retryRef.current()}>Восстановить</Button>
      </AlertRegion>
    )
  }
  if (actionError === 'enable-error') {
    return (
      <AlertRegion label="push-enable-error">
        <p>Не удалось включить push-уведомления. Попробуйте ещё раз.</p>
        <Button variant="secondary" onClick={() => void handleEnable()}>Включить</Button>
      </AlertRegion>
    )
  }

  if (status.subscriptions.length > 0) {
    const subscription = status.subscriptions[0]!
    return (
      <StatusRegion label="push-subscribed">
        <p>Этот браузер зарегистрирован ({subscription.providerHost}) с {new Date(subscription.createdAt).toLocaleDateString('ru-RU')}.</p>
        <Button variant="secondary" onClick={() => void handleDisable()}>Отключить</Button>
      </StatusRegion>
    )
  }
  if (permission === 'denied') {
    return <StatusRegion label="push-permission-denied">Разрешение на уведомления заблокировано в браузере.</StatusRegion>
  }
  if (!status.available || !status.notifyBrowserPush) {
    return <StatusRegion label="push-global-disabled">Push-уведомления выключены глобально в настройках Schlüssel.</StatusRegion>
  }
  if (permission === 'granted') {
    return (
      <StatusRegion label="push-granted-no-subscription">
        <p>Разрешение уже получено — зарегистрируйте этот браузер, чтобы начать получать push.</p>
        <Button variant="primary" onClick={() => void handleEnable()}><Bell size={16}/> Включить</Button>
      </StatusRegion>
    )
  }
  return (
    <StatusRegion label="push-permission-not-requested">
      <p>Получайте уведомления, даже когда вкладка Glocke закрыта.</p>
      <Button variant="primary" onClick={() => void handleEnable()}><Bell size={16}/> Включить</Button>
    </StatusRegion>
  )
}
