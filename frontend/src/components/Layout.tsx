import { Bell, CircleHelp, FileCode2, Settings } from 'lucide-react'
import { Link, useLocation } from '@tanstack/react-router'
import { Footer, Header, ThemeToggle, useAvatarUrl, useUnreadNotifications } from '@zudar107/schloss-ui'
import { useAuth } from '../hooks/useAuth'
import { apiClient } from '../lib/api'
import { buildSchluesselAccountUrl, buildSchluesselLogoutUrl } from '../lib/authRedirect'

const schlossUrl = (import.meta.env.VITE_SCHLOSS_URL as string | undefined) ?? 'http://localhost:3000'
const schluesselUrl = (import.meta.env.VITE_SCHLUSSEL_URL as string | undefined) ?? 'http://localhost:4001'

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth()
  const { pathname } = useLocation()
  const notificationState = useUnreadNotifications({
    glockeOrigin: window.location.origin,
    userId: user?.id ?? null,
    apiClient,
  })
  const avatarUrl = useAvatarUrl({
    schluesselOrigin: schluesselUrl,
    userId: user?.id ?? null,
    apiClient,
  })
  const links = [
    { to: '/notifications', label: 'Уведомления', icon: Bell },
    { to: '/settings', label: 'Настройки', icon: Settings },
    { to: '/help', label: 'Справка', icon: CircleHelp },
    ...(user?.role === 'admin' ? [{ to: '/docs', label: 'API', icon: FileCode2 }] : []),
  ]
  async function signOut() {
    await logout()
    location.href = buildSchluesselLogoutUrl()
  }
  return (
    <div className="app-shell">
      <Header
        logo={<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>}
        homeHref={schlossUrl}
        user={user ? { ...user, avatarUrl } : null}
        notifications={{ href: '/notifications', state: notificationState, glockeOrigin: window.location.origin, apiClient }}
        onSettings={() => { location.href = buildSchluesselAccountUrl(pathname) }}
        onLogout={() => void signOut()}
        rightSlot={<ThemeToggle />}
      />
      <nav className="service-nav" aria-label="Разделы Glocke">
        <div className="brand"><span className="brand-mark"><Bell size={18} /></span><strong>Glocke</strong></div>
        <div className="nav-links">
          {links.map(({ to, label, icon: Icon }) => <Link key={to} to={to} className={pathname === to ? 'active' : ''}><Icon size={17}/><span>{label}</span></Link>)}
        </div>
      </nav>
      <main>{children}</main>
      <Footer serviceName="Glocke" description="Центр уведомлений Hof" version={__APP_VERSION__} helpHref="/help" />
    </div>
  )
}
