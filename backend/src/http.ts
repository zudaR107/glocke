import { createCorsMiddleware, type ExportAuthEnv } from '@zudar107/schloss-server-kit'
import { Hono, type MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { logger } from 'hono/logger'

const privateNotificationResponse: MiddlewareHandler = async (context, next) => {
  context.header('Cache-Control', 'private, no-store')
  context.header('Pragma', 'no-cache')
  context.header('X-Content-Type-Options', 'nosniff')
  await next()
}

export function createHttpApp(
  service: Hono<ExportAuthEnv>,
  allowedOrigins: string[],
  logRequests = true,
): Hono {
  const app = new Hono()

  // Keep private headers outside every middleware that can terminate a request.
  app.use('/notifications', privateNotificationResponse)
  app.use('/notifications/*', privateNotificationResponse)
  app.use('*', bodyLimit({
    maxSize: 1024 * 1024,
    onError: (context) => context.json({ error: 'Request body too large' }, 413),
  }))
  if (logRequests) app.use('*', logger())
  app.use('*', createCorsMiddleware({ allowedOrigins }))
  app.route('/', service)

  return app
}
