import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { setAccessToken } from '../../lib/api'
import { CODE_VERIFIER_STORAGE_KEY } from '../../lib/authRedirect'
import { useAuth, type AuthUser } from '../../hooks/useAuth'

export function AuthCallbackPage() {
  const navigate = useNavigate()
  const { setUser } = useAuth()
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const code = params.get('code')
    const next = params.get('next') ?? '/notifications'
    history.replaceState(null, '', location.pathname)
    const codeVerifier = sessionStorage.getItem(CODE_VERIFIER_STORAGE_KEY)
    sessionStorage.removeItem(CODE_VERIFIER_STORAGE_KEY)
    if (!code || !codeVerifier) { void navigate({ to: next, replace: true }); return }
    fetch('/auth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, codeVerifier }),
    }).then((response) => response.ok ? response.json() as Promise<{ accessToken: string; user: AuthUser }> : null)
      .then((data) => { if (data) { setAccessToken(data.accessToken); setUser(data.user) } })
      .catch(() => undefined)
      .finally(() => void navigate({ to: next, replace: true }))
  }, [navigate, setUser])
  return <div className="callback-screen" aria-label="Завершение входа" />
}
