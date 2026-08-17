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

const invalidateNotificationUnreadCount = vi.hoisted(() => vi.fn())

vi.mock('@zudar107/schloss-ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('@zudar107/schloss-ui')>(),
  invalidateNotificationUnreadCount,
}))

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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('NotificationCenter', () => {
  beforeEach(() => {
    vi.mocked(listNotifications).mockReset()
    vi.mocked(getUnreadCount).mockReset()
    vi.mocked(markNotificationRead).mockReset()
    vi.mocked(markAllNotificationsRead).mockReset()
    vi.mocked(deleteNotification).mockReset()
    invalidateNotificationUnreadCount.mockReset()
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
    const mutation = deferred<Notification>()
    vi.mocked(listNotifications).mockResolvedValue({ items: [unreadNotification], nextCursor: null })
    vi.mocked(getUnreadCount).mockResolvedValue(1)
    vi.mocked(markNotificationRead).mockReturnValue(mutation.promise)

    render(<NotificationCenter />)
    await user.click(await screen.findByRole('button', { name: /mark release is due as read/i }))

    expect(markNotificationRead).toHaveBeenCalledWith('notification-1')
    expect(invalidateNotificationUnreadCount).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Unread notifications')).toHaveTextContent('1')

    mutation.resolve({
      ...unreadNotification,
      readAt: '2026-08-07T10:05:00.000Z',
    })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /mark release is due as read/i })).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Unread notifications')).not.toBeInTheDocument()
    })
    expect(invalidateNotificationUnreadCount).toHaveBeenCalledOnce()
  })

  it('marks all notifications read', async () => {
    const user = userEvent.setup()
    const mutation = deferred<number>()
    const second = { ...unreadNotification, id: 'notification-2', eventId: 'evt-2', title: 'Second event' }
    vi.mocked(listNotifications).mockResolvedValue({ items: [unreadNotification, second], nextCursor: null })
    vi.mocked(getUnreadCount).mockResolvedValue(2)
    vi.mocked(markAllNotificationsRead).mockReturnValue(mutation.promise)

    render(<NotificationCenter />)
    await user.click(await screen.findByRole('button', { name: /mark all as read/i }))

    expect(markAllNotificationsRead).toHaveBeenCalledOnce()
    expect(invalidateNotificationUnreadCount).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Unread notifications')).toHaveTextContent('2')

    mutation.resolve(2)
    await waitFor(() => expect(screen.queryByLabelText('Unread notifications')).not.toBeInTheDocument())
    expect(invalidateNotificationUnreadCount).toHaveBeenCalledOnce()
  })

  it('deletes a notification and removes it from the list', async () => {
    const user = userEvent.setup()
    const mutation = deferred<void>()
    vi.mocked(listNotifications).mockResolvedValue({ items: [unreadNotification], nextCursor: null })
    vi.mocked(getUnreadCount).mockResolvedValue(1)
    vi.mocked(deleteNotification).mockReturnValue(mutation.promise)

    render(<NotificationCenter />)
    await user.click(await screen.findByRole('button', { name: 'Удалить «Release is due»' }))

    expect(deleteNotification).toHaveBeenCalledWith('notification-1')
    expect(invalidateNotificationUnreadCount).not.toHaveBeenCalled()
    expect(screen.getByRole('article', { name: 'Release is due' })).toBeInTheDocument()

    mutation.resolve()
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Release is due' })).not.toBeInTheDocument())
    expect(invalidateNotificationUnreadCount).toHaveBeenCalledOnce()
  })

  it.each([
    ['read one', /mark release is due as read/i, markNotificationRead],
    ['read all', /mark all as read/i, markAllNotificationsRead],
    ['delete', 'Удалить «Release is due»', deleteNotification],
  ] as const)('does not alter unread state or publish invalidation when %s fails', async (_name, buttonName, request) => {
    const user = userEvent.setup()
    vi.mocked(listNotifications).mockResolvedValue({ items: [unreadNotification], nextCursor: null })
    vi.mocked(getUnreadCount).mockResolvedValue(1)
    vi.mocked(request).mockRejectedValue(new Error('mutation failed'))

    render(<NotificationCenter />)
    await user.click(await screen.findByRole('button', { name: buttonName }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Release is due' })).toBeInTheDocument()
    expect(screen.getByLabelText('Unread notifications')).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: /mark release is due as read/i })).toBeInTheDocument()
    expect(invalidateNotificationUnreadCount).not.toHaveBeenCalled()
  })
})
