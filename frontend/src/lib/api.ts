import { createApiClient, ApiError } from '@zudar107/schloss-ui'
import { buildSchluesselLoginUrl } from './authRedirect'

export { ApiError }

export interface Notification {
  id: string
  eventId: string
  source: string
  type: string
  title: string
  body: string
  actionUrl: string | null
  createdAt: string
  readAt: string | null
}

export interface NotificationPage {
  items: Notification[]
  nextCursor: string | null
}

export const apiClient = createApiClient({
  base: '/backend',
  onUnauthorized: () => {
    void buildSchluesselLoginUrl(window.location.pathname + window.location.search).then((url) => {
      window.location.href = url
    })
  },
})

export const setAccessToken = apiClient.setAccessToken
export const getAccessToken = apiClient.getAccessToken
export const api = { get: apiClient.get, post: apiClient.post, put: apiClient.put, delete: apiClient.delete }

export function listNotifications(cursor?: string): Promise<NotificationPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  return api.get(`/notifications${query}`)
}

export async function getUnreadCount(): Promise<number> {
  return (await api.get<{ count: number }>('/notifications/unread-count')).count
}

export function markNotificationRead(id: string): Promise<Notification> {
  return api.post(`/notifications/${encodeURIComponent(id)}/read`, undefined)
}

export async function markAllNotificationsRead(): Promise<number> {
  return (await api.post<{ updated: number }>('/notifications/read-all', undefined)).updated
}

export function deleteNotification(id: string): Promise<void> {
  return api.delete(`/notifications/${encodeURIComponent(id)}`)
}
