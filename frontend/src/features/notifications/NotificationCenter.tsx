import { useEffect, useState } from 'react'
import { Bell, CheckCheck, ExternalLink, RefreshCw, Trash2 } from 'lucide-react'
import { Badge, Button, EmptyState, invalidateNotificationUnreadCount } from '@zudar107/schloss-ui'
import {
  deleteAllNotifications,
  deleteNotification,
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from '../../lib/api'

export function NotificationCenter() {
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [mutationError, setMutationError] = useState('')

  async function load() {
    setLoading(true)
    setError(false)
    try {
      const [page, count] = await Promise.all([listNotifications(), getUnreadCount()])
      setItems(page.items)
      setNextCursor(page.nextCursor)
      setUnread(count)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function markRead(notification: Notification) {
    try {
      const updated = await markNotificationRead(notification.id)
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item))
      setUnread((current) => Math.max(0, current - 1))
      invalidateNotificationUnreadCount()
    } catch {
      setMutationError('Не удалось отметить уведомление прочитанным.')
    }
  }

  async function markAllRead() {
    try {
      await markAllNotificationsRead()
      const readAt = new Date().toISOString()
      setItems((current) => current.map((item) => item.readAt ? item : { ...item, readAt }))
      setUnread(0)
      invalidateNotificationUnreadCount()
    } catch {
      setMutationError('Не удалось отметить все уведомления прочитанными.')
    }
  }

  async function removeAll() {
    try {
      await deleteAllNotifications()
      setItems([])
      setNextCursor(null)
      setUnread(0)
      invalidateNotificationUnreadCount()
    } catch {
      setMutationError('Не удалось удалить все уведомления.')
    }
  }

  async function remove(notification: Notification) {
    try {
      await deleteNotification(notification.id)
      setItems((current) => current.filter((item) => item.id !== notification.id))
      if (!notification.readAt) setUnread((current) => Math.max(0, current - 1))
      invalidateNotificationUnreadCount()
    } catch {
      setMutationError('Не удалось удалить уведомление.')
    }
  }

  async function loadMore() {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const page = await listNotifications(nextCursor)
      setItems((current) => [...current, ...page.items])
      setNextCursor(page.nextCursor)
    } catch {
      setMutationError('Не удалось загрузить следующие уведомления.')
    } finally {
      setLoadingMore(false)
    }
  }

  if (loading) {
    return (
      <div className="state-panel" role="status" aria-label="Loading notifications">
        <span className="spinner" aria-hidden="true" />
        <span>Загружаем уведомления…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="state-panel" role="alert">
        <strong>Не удалось загрузить уведомления</strong>
        <span className="sr-only">Could not load notifications</span>
        <span>Проверьте соединение и попробуйте ещё раз.</span>
        <Button variant="secondary" onClick={() => void load()}><RefreshCw size={16} />Повторить</Button>
      </div>
    )
  }

  return (
    <section aria-label="Уведомления" className="notification-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Glocke</div>
          <h1>Центр уведомлений</h1>
          <p>Важные события сервисов Hof в одном месте.</p>
        </div>
        <div className="heading-actions">
          {unread > 0 && <Badge variant="info"><span aria-label="Unread notifications">{unread}</span> новых</Badge>}
          {unread > 0 && (
            <Button variant="secondary" onClick={() => void markAllRead()} aria-label="Mark all as read">
              <CheckCheck size={16} />Прочитать все
            </Button>
          )}
          {items.length > 0 && (
            <Button variant="secondary" onClick={() => void removeAll()} aria-label="Delete all notifications">
              <Trash2 size={16} />Удалить все
            </Button>
          )}
        </div>
      </div>

      {mutationError && <div role="alert" className="inline-error">{mutationError}</div>}

      {items.length === 0 ? (
        <div className="empty-wrap">
          <span className="sr-only">No notifications yet</span>
          <EmptyState
            icon={<Bell size={25} />}
            title="Уведомлений пока нет"
            description="Когда в сервисах Hof произойдёт важное событие, оно появится здесь."
            actionLabel="Обновить"
            actionIcon={<RefreshCw size={16} />}
            onAction={() => void load()}
          />
        </div>
      ) : (
        <div className="notification-list">
          {items.map((notification) => (
            <article
              key={notification.id}
              aria-label={notification.title}
              className={`notification-card ${notification.readAt ? '' : 'is-unread'}`}
              // Clicking anywhere on an unread card's body marks it read -
              // a mouse/touch convenience on top of (not instead of) the
              // explicit, fully keyboard-accessible button below, which
              // stays the real affordance for keyboard/screen-reader use.
              // Guarded to the actions row so it never double-fires with
              // Открыть/Отметить/Удалить's own clicks.
              onClick={(event) => {
                if ((event.target as HTMLElement).closest('.notification-actions')) return
                if (!notification.readAt) void markRead(notification)
              }}
              style={{ cursor: notification.readAt ? undefined : 'pointer' }}
            >
              <div className="notification-rail" aria-hidden="true" />
              <div className="notification-content">
                <div className="notification-meta">
                  <span className="source-chip">{notification.source}</span>
                  <time dateTime={notification.createdAt}>
                    {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(notification.createdAt))}
                  </time>
                </div>
                <h2>{notification.title}</h2>
                <p>{notification.body}</p>
                <div className="notification-actions">
                  {notification.actionUrl && (
                    <a href={notification.actionUrl}><ExternalLink size={15} />Открыть<span className="sr-only"> Open</span></a>
                  )}
                  {!notification.readAt && (
                    <button type="button" aria-label={`Mark ${notification.title} as read`} onClick={() => void markRead(notification)}>
                      <CheckCheck size={15} />Отметить прочитанным
                    </button>
                  )}
                  <button type="button" className="danger-action" aria-label={`Удалить «${notification.title}»`} onClick={() => void remove(notification)}>
                    <Trash2 size={15} />Удалить
                  </button>
                </div>
              </div>
            </article>
          ))}
          {nextCursor && (
            <Button variant="secondary" disabled={loadingMore} onClick={() => void loadMore()} style={{ alignSelf: 'center' }}>
              {loadingMore ? 'Загрузка…' : 'Показать ещё'}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
