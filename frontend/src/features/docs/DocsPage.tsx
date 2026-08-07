import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { api, getAccessToken } from '../../lib/api'
import 'swagger-ui-dist/swagger-ui.css'

export function DocsPage() {
  const { user } = useAuth()
  const node = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (user?.role !== 'admin' || !node.current) return
    let cancelled = false
    Promise.all([api.get<Record<string, unknown>>('/openapi.json'), import('swagger-ui-dist')]).then(([spec, module]) => {
      if (cancelled || !node.current) return
      module.SwaggerUIBundle({
        domNode: node.current, spec, presets: [module.SwaggerUIBundle.presets.apis],
        requestInterceptor: (request) => {
          (request as unknown as { headers: Record<string, string> }).headers['Authorization'] = `Bearer ${getAccessToken()}`
          return request
        },
      })
    }).catch(() => { if (!cancelled) setError('Не удалось загрузить документацию API') })
    return () => { cancelled = true }
  }, [user])
  if (user?.role !== 'admin') return <section className="state-panel" role="alert"><strong>Доступ только для администраторов</strong></section>
  return <section className="docs-page">{error && <div role="alert" className="inline-error">{error}</div>}<div ref={node}/></section>
}
