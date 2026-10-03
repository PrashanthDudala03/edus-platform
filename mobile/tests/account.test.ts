import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosAdapter, AxiosResponse } from 'axios'
import { createAccountApi } from '../src/api/account.ts'
import { createAuthApi } from '../src/api/auth.ts'
import { NAVIGATION } from '../src/access/experience.ts'
import { ACCOUNT_TYPES, accessRequest, cleanRecoveryCode, cleanSchoolCode, isAccountType, passwordProblem, recoveryCodeProblem } from '../src/features/account/rules.ts'

const CODE = '0f8fad5bd9cb469fa16570867728950e', RECOVERY = 'A1B2C3D4'.repeat(8), PASSWORD = 'correct horse battery'
type Call = { url: string, body: Record<string, unknown>, authorization: unknown }
function server(answer: (call: Call) => { status: number, data?: unknown }) {
  const calls: Call[] = []
  const adapter: AxiosAdapter = async config => {
    const call = { url: String(config.url), body: JSON.parse(String(config.data ?? '{}')), authorization: config.headers?.Authorization }; calls.push(call)
    const reply = answer(call), response = { status: reply.status, statusText: '', data: reply.data, headers: {}, config } as AxiosResponse
    if (reply.status < 300) return response
    throw Object.assign(new Error('Request failed'), { isAxiosError: true, config, response })
  }
  return { account: createAccountApi('https://eduos.test/api/v1', adapter), auth: createAuthApi('https://eduos.test/api/v1', adapter), calls }
}
const form = { firstName: ' Asha ', lastName: ' Verma ', email: ' Asha.Verma@Example.test ', phone: ' 9876543210 ', schoolCode: ` ${CODE.slice(0, 16)} ${CODE.slice(16)}\n`, requestedRole: 'Parent', password: PASSWORD }
const refused = async (work: Promise<unknown>, kind: string, message: RegExp) => assert.rejects(work, error => { const problem = error as { kind: string, message: string }; assert.equal(problem.kind, kind); assert.match(problem.message, message); return true })

test('a request for an account goes to the same endpoint as the web, tidied, with no session and no school id', async () => {
  const { account, calls } = server(() => ({ status: 201, data: { message: 'Your access request has been submitted to the school administrator for approval.' } }))
  assert.match(await account.requestAccess(form), /submitted to the school administrator/)
  assert.deepEqual(calls, [{ url: '/auth/signup', authorization: undefined, body: { firstName: 'Asha', lastName: 'Verma', email: 'asha.verma@example.test', phone: '9876543210', schoolCode: CODE, requestedRole: 'Parent', password: PASSWORD } }])
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['email', 'firstName', 'lastName', 'password', 'phone', 'requestedRole', 'schoolCode'])
})

test('only the account types EduOS accepts can be requested, and never an administrator', async () => {
  assert.deepEqual([...ACCOUNT_TYPES].sort(), ['Parent', 'Principal', 'School Staff', 'Student', 'Teacher'])
  const { account, calls } = server(() => ({ status: 201 }))
  for (const role of ['Administrator', 'SuperAdmin', 'Accountant', 'administrator', 'parent', '', 'Parent ', '__proto__']) {
    assert.equal(isAccountType(role), false)
    await assert.rejects(account.requestAccess({ ...form, requestedRole: role }))
  }
  assert.equal(calls.length, 0)   // nothing was even sent
})

test('if the server refuses an account type, its reason is shown', async () => {
  const { account } = server(() => ({ status: 400, data: { message: 'Select an available account category.' } }))
  await refused(account.requestAccess(form), 'validation', /available account category/)
})

test('an unknown school code and a deactivated school get the same answer, and no school is named', async () => {
  const { account } = server(() => ({ status: 400, data: { message: 'School code is unavailable.' } }))
  await refused(account.requestAccess({ ...form, schoolCode: 'not-a-code' }), 'validation', /^School code is unavailable\.$/)
})

test('a second request for the same email, too many attempts and a server fault are explained plainly', async () => {
  const answers = [{ status: 409, data: { message: 'An account or pending request already exists.' } }, { status: 429 }, { status: 500, data: { message: 'Npgsql.PostgresException at db.internal' } }]
  const { account } = server(() => answers.shift()!)
  await refused(account.requestAccess(form), 'conflict', /already exists/)
  await refused(account.requestAccess(form), 'rate-limited', /Too many attempts/)
  await refused(account.requestAccess(form), 'server', /could not complete this just now/)
})

test('a school code is matched exactly: only spaces from pasting are removed', () => {
  assert.equal(cleanSchoolCode(` ${CODE}\t\n`), CODE)
  assert.equal(cleanSchoolCode('AbC 123'), 'AbC123')
  assert.equal(accessRequest({ ...form, schoolCode: CODE }).schoolCode, CODE)
})

test('passwords follow the EduOS rule: at least 16 characters, at most 72 bytes', () => {
  assert.match(passwordProblem('short'), /at least 16/)
  assert.match(passwordProblem('a'.repeat(15)), /at least 16/)
  assert.equal(passwordProblem('a'.repeat(16)), '')
  assert.equal(passwordProblem('a'.repeat(72)), '')
  assert.match(passwordProblem('a'.repeat(73)), /too long/)
  assert.match(passwordProblem('पासवर्ड'.repeat(4)), /too long/)   // 28 characters, 84 bytes
})

test('a password is reset with the one-time code, like the web, and never with a session', async () => {
  const { account, calls } = server(() => ({ status: 200, data: { message: 'Password changed. Previous sessions have been revoked. Sign in with the new password.' } }))
  assert.match(await account.resetPassword(` ${RECOVERY.toLowerCase().slice(0, 32)} ${RECOVERY.toLowerCase().slice(32)} `, PASSWORD), /Password changed/)
  assert.deepEqual(calls, [{ url: '/auth/reset-password', authorization: undefined, body: { code: RECOVERY, password: PASSWORD } }])
  assert.equal(cleanRecoveryCode(' ab\ncd '), 'ABCD')
  assert.equal(recoveryCodeProblem(RECOVERY), '')
  for (const bad of ['', 'ABC', RECOVERY + 'A', RECOVERY.slice(1) + '!']) assert.match(recoveryCodeProblem(bad), /64-character code/)
})

test('a wrong or expired recovery code is refused without saying which', async () => {
  const { account } = server(() => ({ status: 400, data: { message: 'Recovery code is invalid or expired.' } }))
  await refused(account.resetPassword(RECOVERY, PASSWORD), 'validation', /invalid or expired/)
})

test('sign-in tells a disabled account and a deactivated school apart only after the password is accepted', async () => {
  const answers: Record<string, { status: number, data: unknown }> = {
    wrong: { status: 401, data: { statusCode: 401, message: 'Invalid credentials' } },
    disabled: { status: 403, data: { statusCode: 403, message: 'Your account is currently disabled. Contact your school administrator.' } },
    closed: { status: 403, data: { statusCode: 403, message: "This school's EduOS workspace is deactivated. Contact EduOS support." } },
  }
  const { auth, calls } = server(call => answers[String(call.body.username)])
  await refused(auth.login({ username: 'wrong', password: 'x' }), 'unauthorized', /email, username or password is incorrect/)
  await refused(auth.login({ username: 'disabled', password: 'x' }), 'forbidden', /currently disabled/)
  await refused(auth.login({ username: 'closed', password: 'x' }), 'forbidden', /workspace is deactivated/)
  // Signing in never sends a school code, and a school id only when the person picked a school EduOS listed.
  assert.ok(calls.every(call => !('schoolCode' in call.body) && call.body.schoolId === ''))
})

test('the app has no screen, tab or call for web-only administration', () => {
  const routes = Object.values(NAVIGATION).flat().map(item => item.route)
  assert.ok(routes.length > 0)
  const adminOnly = /template|history|roles?\b|permission|control|billing|subscription|import|school-config|settings|audit|super-admin/i
  for (const route of routes) assert.doesNotMatch(route, adminOnly)
  const files = (folder: string): string[] => readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(folder, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(folder, entry.name)] : [])
  const root = join(import.meta.dirname, '..')
  assert.ok(existsSync(join(root, 'app', '(auth)', 'signup.tsx')) && existsSync(join(root, 'app', '(auth)', 'recover.tsx')))
  for (const file of [...files(join(root, 'app')), ...files(join(root, 'src'))]) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /notifications\/(templates|history)|\/control\/(roles|users|boundary|configuration|signup-requests)|\/suite\/imports|\/billing\//, file)
  }
})
