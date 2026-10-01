import type { User } from '../store/auth'

// Presentation rules for Ask EduOS AI. The backend decides everything that matters: who may ask, which school
// and which documents are used, what the sources are. Nothing here is sent except the question.

export const ASSISTANT_PERMISSION = 'ai.assistant.use'
/** The backend's limit on a question. */
export const MAX_QUESTION_CHARS = 1000
/** From this length on, the remaining characters are shown. */
export const COUNTER_FROM = 800
/** A local model can take a while; the default client timeout is too short for it. */
export const ASK_TIMEOUT_MS = 130_000

export type Source = { number: number; title: string; label: string | null; section: string | null; page: number | null }
export type Reply =
  | { kind: 'answer'; text: string; sources: Source[]; shortened: boolean }
  | { kind: 'notice'; text: string }

export const messages = {
  insufficient: "I couldn't find enough information in your school's available knowledge to answer that.",
  unavailable: 'EduOS AI is temporarily unavailable. Please try again later.',
  disabled: 'EduOS AI is not currently enabled for your school. Your school administrator can tell you more.',
  allowance: "Your school has used its EduOS AI allowance for this month. Your school administrator can tell you more.",
  notSetUp: 'EduOS AI is not available in this workspace yet.',
  notForAccount: 'EduOS AI is not available for your account.',
  tooLong: 'That question could not be processed. Try asking it in fewer words.',
  slow: 'EduOS AI took too long to answer. Please try again.',
  generic: 'EduOS AI could not answer just now. Please try again.',
}

/** School users who hold the permission. The platform administrator has no school to ask about. */
export const canUseAssistant = (user: Pick<User, 'dataScope' | 'permissions'> | null | undefined): boolean =>
  !!user && user.dataScope !== 'platform' && Array.isArray(user.permissions) && user.permissions.includes(ASSISTANT_PERMISSION)

/** The whole request. No school, audience, role, document or earlier message is ever sent. */
export const askBody = (question: string): { question: string } => ({ question: question.trim() })

export const canSend = (draft: string, busy: boolean): boolean => {
  const length = draft.trim().length
  return !busy && length > 0 && length <= MAX_QUESTION_CHARS
}

export const limitHint = (draft: string): string | null => {
  const left = MAX_QUESTION_CHARS - draft.length
  return draft.length < COUNTER_FROM ? null : left <= 0 ? `Limit reached (${MAX_QUESTION_CHARS} characters)` : `${left} character${left === 1 ? '' : 's'} left`
}

const text = (value: unknown, max = 200): string | null => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null

/** Only what the backend listed, and of that only what a reader needs: no identifiers. */
export function sourcesOf(value: unknown): Source[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 20).flatMap((item, index): Source[] => {
    const title = text(item?.title)
    if (!title) return []
    const page = Number.isInteger(item?.page) && item.page > 0 ? item.page as number : null
    return [{ number: Number.isInteger(item?.number) ? item.number as number : index + 1, title, label: text(item?.source), section: text(item?.section), page }]
  })
}

const waitMessage = (seconds: unknown): string => {
  const wait = typeof seconds === 'number' && seconds > 0 ? Math.min(Math.ceil(seconds), 3600) : 0
  return wait ? `You're asking quickly. Please wait ${wait} second${wait === 1 ? '' : 's'} and try again.` : "You're asking quickly. Please wait a moment and try again."
}

/** A fixed sentence for every reason the backend can give. The reason itself is never shown. */
export function noticeFor(reason: unknown, retryAfterSeconds?: unknown): string {
  switch (reason) {
    case 'insufficient-knowledge': return messages.insufficient
    case 'provider-unavailable': case 'provider-timeout': case 'retrieval-unavailable': case 'database-unavailable': return messages.unavailable
    case 'rate-limited': return waitMessage(retryAfterSeconds)
    case 'school-disabled': return messages.disabled
    case 'quota-exceeded': return messages.allowance
    case 'not-configured': return messages.notSetUp
    case 'not-permitted': return messages.notForAccount
    default: return messages.generic
  }
}

/** What to show for the `data` of a 200 response from the assistant. */
export function replyFor(data: unknown): Reply {
  const body = (data ?? {}) as Record<string, unknown>
  if (body.available === true) {
    const answer = typeof body.answer === 'string' ? body.answer.trim() : ''
    return answer ? { kind: 'answer', text: answer, sources: sourcesOf(body.sources), shortened: body.finish === 'length' } : { kind: 'notice', text: messages.generic }
  }
  return { kind: 'notice', text: noticeFor(body.reason, body.retryAfterSeconds) }
}

/** What to show when the request itself failed. Nothing from the response is displayed. */
export function replyForFailure(status: number | undefined, timedOut = false): Reply {
  if (timedOut) return { kind: 'notice', text: messages.slow }
  return { kind: 'notice', text: status === 400 || status === 411 || status === 413 ? messages.tooLong : status === 403 ? messages.notForAccount : status === 429 ? waitMessage(undefined) : status !== undefined && status >= 500 ? messages.unavailable : messages.generic }
}

/** A banner for the panel from GET /ai/status. `blocks` means asking cannot work until something changes. */
export function statusNotice(status: unknown): { text: string; blocks: boolean } | null {
  const body = (status ?? {}) as Record<string, unknown>
  if (body.enabled !== false) return null
  return { text: noticeFor(body.reason === 'insufficient-knowledge' ? undefined : body.reason), blocks: body.reason === 'school-disabled' || body.reason === 'quota-exceeded' || body.reason === 'not-configured' || body.reason === 'not-permitted' }
}
