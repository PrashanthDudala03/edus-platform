import axios, { type AxiosAdapter } from 'axios'
import { apiError, normalizeError, type SchoolChoice } from './errors.ts'
import type { AuthApi, AuthResult, User } from '../session/types.ts'

/**
 * The existing EduOS auth endpoints, called without the session interceptor (they are what creates the session).
 * EduOS finds the school from the account. When a sign-in name exists in several schools it answers 409; if that
 * answer lists the schools, the app offers them and signs in again with the chosen one. The app never asks for or
 * shows a school id.
 */
const MANY_SCHOOLS = 'This sign-in name is used in more than one school. Choosing a school is not available in the app yet; please use the EduOS web portal for this account.'
/** The schools EduOS listed in a 409 sign-in answer, if it listed any. */
export function schoolChoices(data: unknown): SchoolChoice[] {
  const list = (data as { schools?: unknown } | null)?.schools
  if (!Array.isArray(list)) return []
  return list.map(entry => { const row = (entry ?? {}) as Record<string, unknown>; return { id: String(row.id ?? row.schoolId ?? ''), name: String(row.name ?? '').trim() } }).filter(school => /^[0-9a-f-]{36}$/i.test(school.id) && school.name)
}
export function createAuthApi(baseURL: string, adapter?: AxiosAdapter): AuthApi {
  const http = axios.create({ baseURL, timeout: 15000, ...(adapter ? { adapter } : {}) })
  const call = async <T>(request: () => Promise<{ data: { data: T } }>): Promise<T> => {
    try { return (await request()).data.data } catch (error) { throw normalizeError(error) }
  }
  return {
    async login({ username, password, schoolId }) {
      try { return (await http.post('/auth/login', { username: username.trim(), password, schoolId: schoolId ?? '' })).data.data as AuthResult } catch (error) {
        const response = (error as { response?: { status?: number, data?: unknown } }).response
        if (response?.status === 409) { const schools = schoolChoices(response.data); throw apiError('conflict', { status: 409, message: schools.length ? 'Choose your school to continue.' : MANY_SCHOOLS, ...(schools.length ? { schools } : {}) }) }
        const failure = normalizeError(error)
        throw failure.kind === 'unauthorized' ? apiError('unauthorized', { status: 401, message: 'The email, username or password is incorrect.' }) : failure
      }
    },
    refresh: refreshToken => call<AuthResult>(() => http.post('/auth/refresh', { refreshToken })),
    async logout(refreshToken, accessToken) {
      if (!refreshToken) return
      await http.post('/auth/logout', { refreshToken }, { timeout: 5000, headers: accessToken ? { Authorization: 'Bearer ' + accessToken } : {} }).catch(() => undefined)
    },
    me: accessToken => call<User>(() => http.get('/control/me', { headers: { Authorization: 'Bearer ' + accessToken } })),
  }
}
