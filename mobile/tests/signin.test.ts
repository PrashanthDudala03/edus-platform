import test from 'node:test'
import assert from 'node:assert/strict'
import type { AxiosAdapter, AxiosResponse } from 'axios'
import { createAuthApi, schoolChoices } from '../src/api/auth.ts'
import { resolveNotificationRoute } from '../src/notifications/routes.ts'
import type { User } from '../src/session/types.ts'
import { ago } from '../src/utils/format.ts'

const SCHOOL_A = 'aeea48a8-f51f-4676-ada6-2435c711714a', SCHOOL_B = 'a6725488-ccbd-4417-8cb5-ea5e4a7b4889'
function server(answer: (body: Record<string, unknown>) => { status: number, data?: unknown }) {
  const bodies: Record<string, unknown>[] = []
  const adapter: AxiosAdapter = async config => {
    const body = JSON.parse(String(config.data ?? '{}')); bodies.push(body)
    const reply = answer(body), response = { status: reply.status, statusText: '', data: reply.data, headers: {}, config } as AxiosResponse
    if (reply.status < 300) return response
    throw Object.assign(new Error('Request failed'), { isAxiosError: true, config, response })
  }
  return { api: createAuthApi('https://eduos.test/api/v1', adapter), bodies }
}

test('a single-school account signs in without any school being sent or chosen', async () => {
  const { api, bodies } = server(() => ({ status: 200, data: { data: { accessToken: 'a', refreshToken: 'r', expiresIn: 3600, user: { id: 'u' } } } }))
  await api.login({ username: ' asha@example.test ', password: 'not-a-real-password' })
  assert.deepEqual(bodies[0], { username: 'asha@example.test', password: 'not-a-real-password', schoolId: '' })
})

test('when EduOS lists the schools, the app offers them by name and signs in with the chosen one', async () => {
  const { api, bodies } = server(body => body.schoolId ? { status: 200, data: { data: { accessToken: 'a', refreshToken: 'r', expiresIn: 3600, user: { id: 'u', schoolId: body.schoolId } } } }
    : { status: 409, data: { statusCode: 409, message: 'Choose a school.', schools: [{ id: SCHOOL_A, name: 'EduOS Demo School' }, { schoolId: SCHOOL_B, name: ' Suite QA School ' }] } })
  await assert.rejects(api.login({ username: 'shared', password: 'not-a-real-password' }), error => {
    assert.deepEqual(error, { kind: 'conflict', status: 409, retryable: false, message: 'Choose your school to continue.', schools: [{ id: SCHOOL_A, name: 'EduOS Demo School' }, { id: SCHOOL_B, name: 'Suite QA School' }] })
    return true
  })
  const result = await api.login({ username: 'shared', password: 'not-a-real-password', schoolId: SCHOOL_B })
  assert.equal(bodies[1].schoolId, SCHOOL_B)
  assert.equal(result.user.schoolId, SCHOOL_B)
})

test('an EduOS that gives no list still never asks the person for a school id', async () => {
  const { api } = server(() => ({ status: 409, data: { statusCode: 409, message: 'This sign-in name is used in more than one school. Enter your School ID to continue.' } }))
  await assert.rejects(api.login({ username: 'shared', password: 'not-a-real-password' }), error => {
    const problem = error as { kind: string, message: string, schools?: unknown }
    assert.equal(problem.kind, 'conflict')
    assert.equal(problem.schools, undefined)
    assert.match(problem.message, /more than one school/)
    assert.doesNotMatch(problem.message, /School ID/i)
    return true
  })
})

test('only well-formed schools from the server are offered', () => {
  assert.deepEqual(schoolChoices({ schools: [{ id: SCHOOL_A, name: 'A' }, { id: 'not-an-id', name: 'B' }, { id: SCHOOL_B, name: '' }, null, 'x'] }), [{ id: SCHOOL_A, name: 'A' }])
  for (const nothing of [null, undefined, {}, { schools: 'x' }, { schools: {} }]) assert.deepEqual(schoolChoices(nothing), [])
})

test('an attendance notification opens the screen that fits the role', () => {
  const person = (dataScope: string, permissions: string[]): User => ({ id: 'u', username: 'u', email: '', firstName: '', lastName: '', schoolId: 's', roles: [], permissions, dataScope })
  assert.equal(resolveNotificationRoute({ type: 'attendance.absent' }, person('parent', ['reports.view'])).route, '/children')
  assert.equal(resolveNotificationRoute({ type: 'attendance.absent' }, person('teacher', ['attendance.view'])).route, '/register')
  assert.deepEqual(resolveNotificationRoute({ type: 'attendance.absent' }, person('teacher', [])), { route: '/home', reason: 'not-allowed' })
  assert.equal(resolveNotificationRoute({ type: 'circular.published' }, person('student', ['circulars.view'])).route, '/notices')
  for (const type of ['leave.approved', 'leave.rejected']) assert.equal(resolveNotificationRoute({ type }, person('teacher', ['leave-requests.view'])).route, '/leave')
  assert.deepEqual(resolveNotificationRoute({ type: 'leave.decided' }, person('teacher', ['leave-requests.view'])), { route: '/home', reason: 'unknown-type' })
})

test('notification times read naturally', () => {
  const now = new Date('2026-10-02T12:00:00Z')
  assert.deepEqual(['2026-10-02T11:59:40Z', '2026-10-02T11:15:00Z', '2026-10-02T07:00:00Z', '2026-09-29T12:00:00Z', '2026-09-01T12:00:00Z', 'nonsense'].map(value => ago(value, now)), ['Just now', '45 min ago', '5 h ago', '3 d ago', '1 Sep 2026', ''])
})
