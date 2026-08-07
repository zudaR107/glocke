import { AuthContext, useAuth, useAuthProvider as useSharedAuthProvider } from '@zudar107/schloss-ui'
import type { AuthState, AuthUser } from '@zudar107/schloss-ui'
import { apiClient } from '../lib/api'

export type { AuthUser }
export { AuthContext, useAuth }
export function useAuthProvider(): AuthState { return useSharedAuthProvider({ apiClient }) }
