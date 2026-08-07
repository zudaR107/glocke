import { buildAccountUrl, buildLoginUrl, buildLogoutUrl, CODE_VERIFIER_STORAGE_KEY } from '@zudar107/schloss-ui'

const config = () => ({
  schluesselUrl: (import.meta.env.VITE_SCHLUSSEL_URL as string | undefined) ?? 'http://localhost:4001',
})

export { CODE_VERIFIER_STORAGE_KEY }
export const buildSchluesselLoginUrl = (path: string, origin?: string) => buildLoginUrl(config(), path, origin)
export const buildSchluesselLogoutUrl = (returnTo?: string) => buildLogoutUrl(config(), returnTo)
export const buildSchluesselAccountUrl = (path: string, origin?: string) => buildAccountUrl(config(), path, origin)
