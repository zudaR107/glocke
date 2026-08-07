import { RouterProvider } from '@tanstack/react-router'
import { ThemeSync } from '@zudar107/schloss-ui'
import { AuthContext, useAuthProvider } from './hooks/useAuth'
import { router } from './router'

const schluesselUrl = (import.meta.env.VITE_SCHLUSSEL_URL as string | undefined) ?? 'http://localhost:4001'

export function App() {
  const auth = useAuthProvider()
  const theme = <ThemeSync apiOrigin={schluesselUrl} />
  if (auth.loading) return <>{theme}<div className="callback-screen">Загрузка…</div></>
  return <AuthContext.Provider value={auth}>{theme}<RouterProvider router={router} /></AuthContext.Provider>
}
