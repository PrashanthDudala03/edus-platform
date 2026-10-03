import { apiError, normalizeError } from '../api/errors.ts'
import type { AuthApi, Credentials, SecureStorage, SessionState, User } from './types.ts'

// The session in one place. The refresh token rests only in secure storage; the access token lives only in this
// closure and is gone when the app process ends. Nothing here knows about React, so it runs unchanged in tests.
export const REFRESH_TOKEN_KEY = 'eduos.refresh-token'
export const SESSION_ENDED = 'Your session has ended. Please sign in again.'
export const OFFLINE_RESTORE = 'You are offline. Connect to the internet to continue.'

export interface SessionDeps {
  auth: AuthApi
  storage: SecureStorage
  /** Called with every new state; the app mirrors it into its store. */
  onState: (state: SessionState) => void
  /** Clears everything fetched for the previous person (the query cache). */
  clearCaches: () => void
}
export type Cleanup = () => Promise<void> | void
export type SessionController = ReturnType<typeof createSessionController>

export function createSessionController({ auth, storage, onState, clearCaches }: SessionDeps) {
  let accessToken: string | null = null
  let state: SessionState = { status: 'restoring', user: null, notice: null, restorePending: false, welcomePending: false }
  let refreshing: Promise<string> | null = null
  const cleanups = new Set<Cleanup>()
  const publish = (next: Partial<SessionState>) => { state = { ...state, ...next }; onState(state) }

  async function forget(notice: string | null) {
    accessToken = null
    await storage.remove(REFRESH_TOKEN_KEY).catch(() => undefined)
    clearCaches()
    publish({ status: 'signed-out', user: null, notice, restorePending: false, welcomePending: false })
  }

  // One refresh at a time: every request that finds its token expired waits for the same answer.
  function refresh(): Promise<string> {
    refreshing ??= (async () => {
      const stored = await storage.get(REFRESH_TOKEN_KEY)
      if (!stored) throw apiError('unauthorized')
      const result = await auth.refresh(stored)
      await storage.set(REFRESH_TOKEN_KEY, result.refreshToken)
      accessToken = result.accessToken
      publish({ status: 'signed-in', user: result.user, notice: null, restorePending: false })
      return result.accessToken
    })().finally(() => { refreshing = null })
    return refreshing
  }

  return {
    getState: () => state,
    getAccessToken: () => accessToken,
    refresh,

    /** On launch: a stored refresh token is exchanged for a fresh session; without one the person signs in. */
    async restore() {
      if (!(await storage.get(REFRESH_TOKEN_KEY).catch(() => null))) { publish({ status: 'signed-out', restorePending: false }); return }
      try { await refresh() } catch (error) {
        const failure = normalizeError(error)
        // Without a connection the stored session is kept, so it can be tried again; a refused token is discarded.
        if (failure.kind === 'offline' || failure.kind === 'timeout' || failure.kind === 'server') publish({ status: 'signed-out', user: null, notice: OFFLINE_RESTORE, restorePending: true })
        else await forget(SESSION_ENDED)
      }
    },

    /** Signs in, then asks EduOS who this is: role, data scope and permissions come from /control/me, not from the form. */
    async signIn(credentials: Credentials) {
      const result = await auth.login(credentials)
      let user: User
      try { user = await auth.me(result.accessToken) } catch (error) { await auth.logout(result.refreshToken, result.accessToken).catch(() => undefined); throw error }
      await storage.set(REFRESH_TOKEN_KEY, result.refreshToken)
      accessToken = result.accessToken
      clearCaches()
      publish({ status: 'signed-in', user, notice: null, restorePending: false, welcomePending: true })
    },

    /** Called when a request is refused even after a refresh, or the refresh itself is refused. */
    async expire() { if (state.status !== 'signed-out' || state.restorePending) await forget(SESSION_ENDED) },

    /** Signing out removes everything sensitive from the device, even when the server cannot be reached. */
    async signOut() {
      const stored = await storage.get(REFRESH_TOKEN_KEY).catch(() => null)
      // Cleanups run while the session still works, so they can tell the server (for example to forget a push token).
      for (const cleanup of cleanups) await Promise.resolve().then(cleanup).catch(() => undefined)
      await auth.logout(stored, accessToken).catch(() => undefined)
      await forget(null)
    },

    /** Registers work to do at sign-out. Returns a function that removes it again. */
    registerCleanup(cleanup: Cleanup) { cleanups.add(cleanup); return () => { cleanups.delete(cleanup) } },
    /** Keeps the person's role and permissions current while the app is open. */
    updateUser(user: User) { if (state.status === 'signed-in') publish({ user }) },
    welcomeShown() { if (state.welcomePending) publish({ welcomePending: false }) },
  }
}
