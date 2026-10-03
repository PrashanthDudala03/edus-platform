import { AppState } from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import { Image } from 'expo-image'
import * as SecureStore from 'expo-secure-store'
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query'
import { create } from 'zustand'
import { createAccountApi } from './api/account'
import { createAuthApi } from './api/auth'
import { createApiClient } from './api/client'
import { normalizeError } from './api/errors'
import { checkApiUrl } from './api/url'
import { deviceRegistration } from './notifications/routes'
import { createSessionController } from './session/controller'
import type { SecureStorage, SessionState } from './session/types'

// The app's long-lived objects, created once. Screens import from here; nothing else builds a client or a session.
const configured = checkApiUrl(process.env.EXPO_PUBLIC_API_URL, __DEV__)
export const API_URL = configured.url
/** Set when the app cannot talk to EduOS at all; the root layout shows it instead of the sign-in screen. */
export const configurationProblem = configured.problem

// The refresh token rests in the Keychain (iOS) or Keystore-backed storage (Android), and does not move to a new device.
const secureStorage: SecureStorage = {
  get: key => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  remove: key => SecureStore.deleteItemAsync(key),
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: (failures, error) => failures < 2 && normalizeError(error).retryable },
    mutations: { retry: false },
  },
})
// Requests pause while the device is offline and resume by themselves; data refreshes when the app returns to the front.
onlineManager.setEventListener(setOnline => NetInfo.addEventListener(state => setOnline(state.isConnected !== false)))
AppState.addEventListener('change', state => focusManager.setFocused(state === 'active'))

export const useSession = create<SessionState>(() => ({ status: 'restoring', user: null, notice: null, restorePending: false, welcomePending: false }))
export const session = createSessionController({
  auth: createAuthApi(API_URL),
  storage: secureStorage,
  onState: state => useSession.setState(state, true),
  // Nothing fetched or drawn for one account or school may survive into the next: data and school photographs both go.
  clearCaches: () => { queryClient.clear(); Image.clearMemoryCache().catch(() => undefined); Image.clearDiskCache().catch(() => undefined) },
})
export const api = createApiClient({ baseURL: API_URL, session })
/** Asking a school for an account and resetting a password: public endpoints that never carry a session. */
export const account = createAccountApi(API_URL)

// Future push registration: sign-out already calls this while the session is still valid.
session.registerCleanup(() => deviceRegistration.unregister())
