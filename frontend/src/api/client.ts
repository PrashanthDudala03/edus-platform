import axios from 'axios'
import { useAuthStore } from '../store/auth'
const API_URL = import.meta.env.VITE_API_URL || '/api/v1'
const client = axios.create({ baseURL: API_URL, timeout: 15000 })
client.interceptors.request.use(config => {
  const token = useAuthStore.getState().accessToken
  if (token) config.headers.Authorization = 'Bearer ' + token
  return config
})
let refreshing: Promise<string> | null = null
client.interceptors.response.use(response => response, async error => {
  const request = error.config
  if (error.response?.status !== 401 || !request || request._retry || request.url?.startsWith('/auth/')) return Promise.reject(error)
  request._retry = true
  if (!refreshing) refreshing = (async () => {
    const state = useAuthStore.getState()
    if (!state.refreshToken || !state.user) throw new Error('Please sign in again.')
    const response = await axios.post(API_URL + '/auth/refresh', { refreshToken: state.refreshToken }, { timeout: 15000 })
    const result = response.data.data
    state.setAuth(result.user, result.accessToken, result.refreshToken)
    return result.accessToken as string
  })().finally(() => { refreshing = null })
  try {
    const token = await refreshing
    request.headers.Authorization = 'Bearer ' + token
    return client(request)
  } catch (refreshError) {
    useAuthStore.getState().clearAuth()
    return Promise.reject(refreshError)
  }
})
export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const details = error.response?.data?.errors
    return Array.isArray(details) ? details.map((e: {message: string}) => e.message).join(' ') :
      error.response?.data?.message || (error.response?.status === 403 ? 'Your account does not have access to this school or action.' :
      error.response?.status === 409 ? 'A record with these details already exists.' : 'Could not complete the request. Check your connection and try again.')
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}
export default client
export { API_URL }
