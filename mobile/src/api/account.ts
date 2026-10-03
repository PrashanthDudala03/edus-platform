import axios, { type AxiosAdapter } from 'axios'
import { apiError, normalizeError } from './errors.ts'
import { accessRequest, cleanRecoveryCode, type AccessRequest } from '../features/account/rules.ts'

/**
 * The two public EduOS account endpoints the web portal also uses: asking a school for an account, and setting a new
 * password with a one-time recovery code. Neither needs or sends a session. Nothing here creates a usable account:
 * a request waits for the school administrator, who verifies the person and assigns the role.
 */
export interface AccountApi {
  /** Sends a request for access to the school that issued the code. Resolves with EduOS's confirmation. */
  requestAccess(form: AccessRequest): Promise<string>
  /** Sets a new password with a recovery code. EduOS then signs out every device of that account. */
  resetPassword(code: string, password: string): Promise<string>
}
const SUBMITTED = 'Your access request has been submitted to the school administrator for approval.'
const CHANGED = 'Password changed. Sign in with the new password.'

export function createAccountApi(baseURL: string, adapter?: AxiosAdapter): AccountApi {
  const http = axios.create({ baseURL, timeout: 20000, ...(adapter ? { adapter } : {}) })
  const send = async (path: string, body: unknown, fallback: string, expired?: string) => {
    try {
      const message = (await http.post(path, body)).data?.message
      return typeof message === 'string' && message.trim() ? message.trim() : fallback
    } catch (error) {
      const failure = normalizeError(error)
      // These endpoints have no session, so a refusal is about the details entered, never "your session has ended".
      throw failure.kind === 'unauthorized' ? apiError('validation', { status: failure.status, message: expired ?? 'These details were not accepted.' }) : failure
    }
  }
  return {
    async requestAccess(form) {
      let request: AccessRequest
      try { request = accessRequest(form) } catch { throw apiError('validation', { message: 'Choose an account type.' }) }
      return send('/auth/signup', request, SUBMITTED)
    },
    resetPassword: (code, password) => send('/auth/reset-password', { code: cleanRecoveryCode(code), password }, CHANGED, 'Recovery code is invalid or expired.'),
  }
}
