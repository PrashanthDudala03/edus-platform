import { create } from 'zustand'

export interface User {
  dataScope?: string
  id: string
  username: string
  email: string
  firstName: string
  lastName: string
  schoolId: string
  roles: string[]
  permissions: string[]
}

interface AuthStore {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  /** Shown on the sign-in page after a session ends without the user signing out. */
  notice: string | null
  setAuth: (user: User, accessToken: string, refreshToken: string) => void
  clearAuth: (notice?: string) => void
  hasPermission: (permission: string) => boolean
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  accessToken: localStorage.getItem('accessToken'),
  refreshToken: localStorage.getItem('refreshToken'),
  isAuthenticated: !!localStorage.getItem('accessToken'),
  notice: null,

  setAuth: (user, accessToken, refreshToken) => {
    localStorage.setItem('accessToken', accessToken)
    localStorage.setItem('refreshToken', refreshToken)
    localStorage.setItem('user', JSON.stringify(user))
    set({ user, accessToken, refreshToken, isAuthenticated: true, notice: null })
  },

  clearAuth: (notice) => {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('user')
    set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false, notice: notice ?? null })
  },

  hasPermission: (permission: string) => {
    const { user } = get()
    return user?.permissions.includes(permission) ?? false
  },
}))

// Load user from localStorage on init
if (localStorage.getItem('user')) {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}')
    useAuthStore.setState({ user })
  } catch (e) {
    console.error('Failed to load user from storage', e)
  }
}
