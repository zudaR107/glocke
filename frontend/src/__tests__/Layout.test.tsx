import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Layout } from '../components/Layout'

const useUnreadNotifications = vi.hoisted(() => vi.fn())
const apiClient = vi.hoisted(() => ({ getAccessToken: vi.fn() }))

vi.mock('@zudar107/schloss-ui', () => ({
  Header: ({ notifications }: { notifications?: { href: string; state: { status: string; unreadCount?: number } } }) => (
    <header>
      {notifications && <a href={notifications.href} aria-label="Уведомления Glocke">{notifications.state.unreadCount}</a>}
    </header>
  ),
  Footer: () => <footer />,
  ThemeToggle: () => <button type="button">Theme</button>,
  useUnreadNotifications,
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: React.ComponentProps<'a'> & { to: string }) => <a href={to} {...props}>{children}</a>,
  useLocation: () => ({ pathname: '/settings' }),
}))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-1', name: 'Test User', email: 'user@example.test', role: 'user' },
    logout: vi.fn(),
  }),
}))

vi.mock('../lib/api', () => ({ apiClient }))

describe('Layout notification bell', () => {
  beforeEach(() => {
    vi.stubGlobal('__APP_VERSION__', 'test')
    useUnreadNotifications.mockReset()
    useUnreadNotifications.mockReturnValue({ status: 'ready', unreadCount: 7 })
  })

  it('passes Glocke local notification state to the shared Header bell', () => {
    render(<Layout><div>Page</div></Layout>)

    expect(useUnreadNotifications).toHaveBeenCalledOnce()
    expect(useUnreadNotifications).toHaveBeenCalledWith({
      glockeOrigin: window.location.origin,
      userId: 'user-1',
      apiClient,
    })
    expect(screen.getByRole('link', { name: 'Уведомления Glocke' })).toHaveAttribute('href', '/notifications')
    expect(screen.getByRole('link', { name: 'Уведомления Glocke' })).toHaveTextContent('7')
  })
})
