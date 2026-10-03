// Creating an account and resetting a password, exactly as EduOS web does them. The server owns every rule; these
// checks only save a round trip and never grant anything. Pure, so they are tested without the app.

/**
 * What a person may ask to be. This is a request, not a grant: a school administrator reviews it, verifies the
 * person and assigns the role (or rejects it). EduOS accepts exactly these categories; an administrator account is
 * never requested here.
 */
export const ACCOUNT_TYPES = ['Parent', 'Student', 'Teacher', 'School Staff', 'Principal'] as const
export type AccountType = typeof ACCOUNT_TYPES[number]
export const isAccountType = (value: unknown): value is AccountType => typeof value === 'string' && (ACCOUNT_TYPES as readonly string[]).includes(value)

export const PASSWORD_MIN = 16, PASSWORD_MAX_BYTES = 72, RECOVERY_CODE_LENGTH = 64

/** EduOS passwords: at least 16 characters and at most 72 bytes once encoded. Empty when the password is acceptable. */
export function passwordProblem(password: string): string {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`
  return new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES ? 'That password is too long.' : ''
}

/**
 * The school code a school gives to people who should request an account. It is matched exactly, so only stray
 * spaces and line breaks from pasting are removed. It is not the school's internal id and is never shown again.
 */
export const cleanSchoolCode = (text: string) => text.replace(/\s+/g, '')
/** A one-time recovery code as issued by a school administrator: 64 characters, case does not matter. */
export const cleanRecoveryCode = (text: string) => text.replace(/\s+/g, '').toUpperCase()
export const recoveryCodeProblem = (code: string) => /^[0-9A-Z]{64}$/.test(cleanRecoveryCode(code)) ? '' : `Enter the ${RECOVERY_CODE_LENGTH}-character code from your school administrator.`

export interface AccessRequest { firstName: string, lastName: string, email: string, phone: string, schoolCode: string, requestedRole: string, password: string }
/** The request EduOS expects, tidied. An account type outside the list is refused here and again by the server. */
export function accessRequest(form: AccessRequest): AccessRequest {
  if (!isAccountType(form.requestedRole)) throw new Error('Choose an account type.')
  return { firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim().toLowerCase(), phone: form.phone.trim(), schoolCode: cleanSchoolCode(form.schoolCode), requestedRole: form.requestedRole, password: form.password }
}
