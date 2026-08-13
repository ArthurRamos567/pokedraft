import { createAuthClient } from 'better-auth/react'
import { API_URL } from './api'

export const authClient = createAuthClient({
  baseURL: `${API_URL}/api/auth`,
  fetchOptions: { credentials: 'include' },
})

export const { signIn, signUp, signOut, useSession } = authClient
