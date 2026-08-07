import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationCenter } from '../features/notifications/NotificationCenter'
import {
  getUnreadCount,
  deleteNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from '../lib/api'

vi.mock('../lib/api', () => ({
  listNotifications: vi.fn(),
  getUnreadCount: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  deleteNotification: vi.fn(),
}))

const unreadNotification: Notification = {
  id: 'notification-1',
  eventId: 'evt-1',
  source: 'tafel',
  type: 'task.due',
  title: 'Release is due',
  body: 'Prepare the release notes',
  actionUrl: '/tasks/task-1',
  createdAt: '2026-08-07T10:00:00.000Z',
  readAt: null,
}

describe('NotificationCenter', () => {
  beforeEach(() => {
    vi.mocked(listNotifications).mockReset()
    vi.mocked(getUnreadCount).mockReset()
    vi.mocked(markNotificationRead).mockReset()
    vi.mocked(markAllNotificationsRead).mockReset()
    vi.mocked(deleteNotification).mockReset()
    vi.mocked(getUnreadCount).mockResolvedValue(0)
  })

  it('displays a loading state while notifications are pending', () => {
    vi.mocked(listNotifications).mockReturnValue(new Promise(() => {}))

    render(<NotificationCenter />)

    expect(screen.getByRole('status', { name: /loading notifications/i })).toBeInTheDocument()
  })

  it('displays an empty state', async () => {
    vi.mocked(listNotifications).mockResolvedValue({ items: [], nextCursor: null })

    render(<NotificationCenter />)

    expect(await screen.findByText(/no notifications yet/i)).toBeInTheDocument()
  })

  it('displays an accessible error when loading fails', async () => {
    vi.mocked(listNotifications).mockRejectedValue(new Error('network unavailable'))

    render(<NotificationCenter />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load notifications/i)
  })

  it('renders notification content, source, action, and unread count', async () => {
    vi.mocked(listNotifications).mockResolvedValue({ items: [unreadNotification], nextCursor: null })
    vi.mocked(getUnreadCount).mockResolvedValue(1)

    render(<NotificationCenter />)

    const item = await screen.findByRole('article', { name: 'Release is due' })
    expect(within(item).getByText('Prepare the release notes')).toBeInTheDocument()
    expect(within(item).getByText(/tafel/i)).toBeInTheDocument()
    expect(within(item).getByRole('link', { name: /open/i })).toHaveAttribute('href', '/tasks/task-1')
    expect(screen.getByText('1', { selector: '[aria-label="Unread notifications"]' })).toBeInTheDocument()
  })

  it('marks one notification read and updates its unread presentation', async () => {
    const user = userEvent.setup()
    vi.mocked(listNotifications).mockResolvedValue({ items: [unreadNotification], nextCursor: null })
    vi.mocked(getUnreadCount).mockResolvedValue(1)
    vi.mocked(markNotificationRead).mockResolvedValue({
      ...unreadNotification,
      readAt: '2026-08-07T10:05:00.000Z',
    })

    render(<NotificationCenter />)
    await user.click(await screen.findByRole('button', { name: /mark release is due as read/i }))

    expect(markNotificationRead).toHaveBeenCalledWith('notification-1')
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /mark release is due as read/i })).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Unread notifications')).not.toBeInTheDocument()
    })
  })

  it('marks all notifications read', async () => {
    const user = userEvent.setup()
    const second = { ...unreadNotification, id: 'notification-2', eventId: 'evt-2', title: 'Second event' }
    vi.mocked(listNotifications).mockResolvedValue({ items: [unreadNotification, second], nextCursor: null })
    vi.mocked(getUnreadCount).mockResolvedValue(2)
    vi.mocked(markAllNotificationsRead).mockResolvedValue(2)

    render(<NotificationCenter />)
    await user.click(await screen.findByRole('button', { name: /mark all as read/i }))

    expect(markAllNotificationsRead).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByLabelText('Unread notifications')).not.toBeInTheDocument())
  })

  it('deletes a notification and removes it from the list', async () => {
    const user = userEvent.setup()
    vi.mocked(listNotifications).mockResolvedValue({ items: [unreadNotification], nextCursor: null })
    vi.mocked(getUnreadCount).mockResolvedValue(1)
    vi.mocked(deleteNotification).mockResolvedValue()

    render(<NotificationCenter />)
    await user.click(await screen.findByRole('button', { name: 'Удалить «Release is due»' }))

    expect(deleteNotification).toHaveBeenCalledWith('notification-1')
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Release is due' })).not.toBeInTheDocument())
  })
})
