// One error shape for every screen. EduOS services answer with different bodies ({message}, {statusCode,message,errors}),
// and nginx answers 429 with no JSON at all, so nothing outside this file reads a raw HTTP error.
export type ApiErrorKind =
  | 'offline' | 'timeout' | 'unauthorized' | 'forbidden' | 'not-found' | 'conflict' | 'rate-limited' | 'validation' | 'server' | 'unknown'

export interface ApiError {
  kind: ApiErrorKind
  /** Safe to show to the person using the app. Never contains server internals. */
  message: string
  status?: number
  /** Field name to message, for validation failures. */
  fields?: Record<string, string>
  /** True when trying the same request again can reasonably succeed. */
  retryable: boolean
  /** Sign-in only: the schools this sign-in name belongs to, when EduOS asks the person to choose one. */
  schools?: SchoolChoice[]
}
/** A school offered by EduOS at sign-in. The id is passed back unchanged and never shown. */
export interface SchoolChoice { id: string, name: string }

const DEFAULTS: Record<ApiErrorKind, string> = {
  offline: 'You are offline. Check your connection and try again.',
  timeout: 'EduOS took too long to respond. Try again.',
  unauthorized: 'Your session has ended. Please sign in again.',
  forbidden: 'Your account does not have access to this.',
  'not-found': 'This could not be found. It may have been removed.',
  conflict: 'This was changed by someone else. Refresh and try again.',
  'rate-limited': 'Too many attempts. Wait a minute and try again.',
  validation: 'Some details need correcting.',
  server: 'EduOS could not complete this just now. Try again shortly.',
  unknown: 'Something went wrong. Try again.',
}
const RETRYABLE: ApiErrorKind[] = ['offline', 'timeout', 'rate-limited', 'server']

const kindForStatus = (status: number): ApiErrorKind =>
  status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 404 ? 'not-found' : status === 409 ? 'conflict'
    : status === 429 ? 'rate-limited' : status === 400 || status === 422 ? 'validation' : status >= 500 ? 'server' : 'unknown'

// A server message is shown only for errors the person can act on, and only when it is plain, short text.
function serverMessage(data: unknown): string | undefined {
  const message = (data as { message?: unknown } | null)?.message
  return typeof message === 'string' && message.trim().length > 0 && message.length <= 240 && !/exception|stack|sql|npgsql| at [\w.]+\(/i.test(message) ? message.trim() : undefined
}
function fieldMessages(data: unknown): Record<string, string> | undefined {
  const errors = (data as { errors?: unknown } | null)?.errors
  if (!Array.isArray(errors)) return undefined
  const fields: Record<string, string> = {}
  for (const entry of errors) {
    const { field, message } = (entry ?? {}) as { field?: unknown, message?: unknown }
    if (typeof message === 'string') fields[typeof field === 'string' && field ? field : '_'] = message
  }
  return Object.keys(fields).length ? fields : undefined
}

export function apiError(kind: ApiErrorKind, overrides: Partial<ApiError> = {}): ApiError {
  return { kind, message: DEFAULTS[kind], retryable: RETRYABLE.includes(kind), ...overrides }
}
export function isApiError(value: unknown): value is ApiError {
  return typeof value === 'object' && value !== null && typeof (value as ApiError).kind === 'string' && typeof (value as ApiError).message === 'string' && typeof (value as ApiError).retryable === 'boolean'
}

/** Turns anything thrown by the HTTP layer into an ApiError. Already-normalised errors pass through unchanged. */
export function normalizeError(error: unknown): ApiError {
  if (isApiError(error)) return error
  const e = (error ?? {}) as { code?: string, message?: string, response?: { status?: number, data?: unknown } }
  const status = e.response?.status
  if (typeof status === 'number') {
    const kind = kindForStatus(status), fields = kind === 'validation' ? fieldMessages(e.response?.data) : undefined
    const message = kind === 'server' || kind === 'unauthorized' ? undefined : fields ? Object.values(fields).join(' ') : serverMessage(e.response?.data)
    return apiError(kind, { status, ...(message ? { message } : {}), ...(fields ? { fields } : {}) })
  }
  if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' || /timeout/i.test(e.message ?? '')) return apiError('timeout')
  if (e.code === 'ERR_NETWORK' || /network error/i.test(e.message ?? '')) return apiError('offline')
  return apiError('unknown')
}
