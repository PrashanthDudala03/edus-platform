import axios, { type AxiosAdapter, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'
import { normalizeError } from './errors.ts'

export interface ClientSession {
  getAccessToken(): string | null
  /** Resolves with a new access token. Concurrent callers share one refresh. */
  refresh(): Promise<string>
  /** The session cannot be continued; the person must sign in again. */
  expire(): Promise<void>
}
export interface ClientOptions { baseURL: string, session: ClientSession, timeoutMs?: number, adapter?: AxiosAdapter }
type Retried = InternalAxiosRequestConfig & { _retried?: boolean }

/**
 * The single HTTP client for EduOS data. It attaches the access token, refreshes once when the token has expired and
 * repeats the request, and rejects with a normalised ApiError. It never adds a school id: the gateway takes the school
 * from the verified token.
 */
export function createApiClient({ baseURL, session, timeoutMs = 15000, adapter }: ClientOptions): AxiosInstance {
  const client = axios.create({ baseURL, timeout: timeoutMs, ...(adapter ? { adapter } : {}) })
  client.interceptors.request.use(config => {
    const token = session.getAccessToken()
    if (token) config.headers.Authorization = 'Bearer ' + token
    return config
  })
  client.interceptors.response.use(response => response, async error => {
    const request = error?.config as Retried | undefined
    if (error?.response?.status !== 401 || !request || request._retried) return Promise.reject(normalizeError(error))
    request._retried = true
    let token: string
    try { token = await session.refresh() } catch (refreshError) {
      const failure = normalizeError(refreshError)
      // Only a refused refresh ends the session. A dropped connection leaves it in place to try again.
      if (failure.kind === 'unauthorized' || failure.kind === 'forbidden') await session.expire()
      return Promise.reject(failure)
    }
    request.headers.Authorization = 'Bearer ' + token
    try { return await client.request(request) } catch (retryError) {
      const failure = normalizeError(retryError)
      if (failure.kind === 'unauthorized') await session.expire()
      return Promise.reject(failure)
    }
  })
  return client
}
