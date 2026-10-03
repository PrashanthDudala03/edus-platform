// Run with `npm test` (Node's own test runner; no device, no server, nothing to start).
import test from 'node:test'
import assert from 'node:assert/strict'
import { apiError } from '../src/api/errors.ts'
import { OFFLINE_RESTORE, REFRESH_TOKEN_KEY, SESSION_ENDED, createSessionController } from '../src/session/controller.ts'
import type { AuthApi, AuthResult, SecureStorage, SessionState, User } from '../src/session/types.ts'

const user: User = { id: 'u1', username: 'asha.parent', email: 'asha@example.test', firstName: 'Asha', lastName: 'Rao', schoolId: 'school-1', roles: ['Parent'], permissions: ['reports.view'], dataScope: 'parent' }
const result = (n: number, who: User = user): AuthResult => ({ accessToken: 'access-' + n, refreshToken: 'refresh-' + n, expiresIn: 3600, user: who })

function setup(overrides: Partial<AuthApi> = {}, stored: string | null = null) {
  const values = new Map<string, string>(stored ? [[REFRESH_TOKEN_KEY, stored]] : []), states: SessionState[] = [], calls: string[] = []
  const storage: SecureStorage = { get: async key => values.get(key) ?? null, set: async (key, value) => { values.set(key, value) }, remove: async key => { values.delete(key) } }
  let issued = 0
  const auth: AuthApi = {
    login: async () => { calls.push('login'); return result(++issued) },
    refresh: async token => { calls.push('refresh:' + token); return result(++issued) },
    logout: async (refreshToken, accessToken) => { calls.push(`logout:${refreshToken}:${accessToken}`) },
    me: async token => { calls.push('me:' + token); return { ...user, permissions: ['reports.view', 'fees.view'] } },
    ...overrides,
  }
  let cleared = 0
  const session = createSessionController({ auth, storage, onState: state => states.push(state), clearCaches: () => { cleared++ } })
  return { session, values, states, calls, cleared: () => cleared }
}

test('signing in stores only the refresh token and takes the account from /control/me', async () => {
  const { session, values, calls } = setup()
  await session.signIn({ username: 'asha.parent', password: 'not-a-real-password' })
  assert.deepEqual(calls, ['login', 'me:access-1'])
  assert.deepEqual([...values.entries()], [[REFRESH_TOKEN_KEY, 'refresh-1']])
  assert.equal(session.getAccessToken(), 'access-1')
  const state = session.getState()
  assert.equal(state.status, 'signed-in')
  assert.deepEqual(state.user?.permissions, ['reports.view', 'fees.view'])
  assert.equal(state.welcomePending, true)
  assert.ok(![...values.values()].some(value => value.includes('access-') || value.includes('not-a-real-password')), 'neither the access token nor the password is stored')
})

test('a sign-in whose account cannot be read leaves nothing behind', async () => {
  const { session, values, calls } = setup({ me: async () => { throw apiError('forbidden') } })
  await assert.rejects(session.signIn({ username: 'x', password: 'y' }), { kind: 'forbidden' })
  assert.equal(values.size, 0)
  assert.equal(session.getAccessToken(), null)
  assert.ok(calls.includes('logout:refresh-1:access-1'), 'the half-made session is ended on the server')
})

test('restoring with no stored session asks the person to sign in', async () => {
  const { session, calls } = setup()
  await session.restore()
  assert.equal(session.getState().status, 'signed-out')
  assert.equal(session.getState().notice, null)
  assert.deepEqual(calls, [])
})

test('restoring exchanges the stored refresh token for a new session and rotates it', async () => {
  const { session, values, calls } = setup({}, 'refresh-old')
  await session.restore()
  assert.deepEqual(calls, ['refresh:refresh-old'])
  assert.equal(values.get(REFRESH_TOKEN_KEY), 'refresh-1')
  assert.equal(session.getAccessToken(), 'access-1')
  assert.equal(session.getState().status, 'signed-in')
  assert.equal(session.getState().welcomePending, false, 'School Home is shown after signing in, not on every launch')
})

test('a refused refresh token ends the session and removes it from the device', async () => {
  const { session, values, cleared } = setup({ refresh: async () => { throw apiError('unauthorized') } }, 'refresh-old')
  await session.restore()
  assert.equal(values.size, 0)
  assert.deepEqual({ status: session.getState().status, notice: session.getState().notice, restorePending: session.getState().restorePending }, { status: 'signed-out', notice: SESSION_ENDED, restorePending: false })
  assert.equal(cleared(), 1)
})

test('being offline at launch keeps the stored session so it can be tried again', async () => {
  let online = false
  const { session, values } = setup({ refresh: async () => { if (!online) throw apiError('offline'); return result(7) } }, 'refresh-old')
  await session.restore()
  assert.equal(values.get(REFRESH_TOKEN_KEY), 'refresh-old')
  assert.deepEqual({ status: session.getState().status, notice: session.getState().notice, restorePending: session.getState().restorePending }, { status: 'signed-out', notice: OFFLINE_RESTORE, restorePending: true })
  online = true
  await session.restore()
  assert.equal(session.getState().status, 'signed-in')
  assert.equal(session.getState().restorePending, false)
})

test('concurrent refreshes share one request', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const { session, calls } = setup({ refresh: async token => { calls.push('refresh:' + token); await gate; return result(5) } }, 'refresh-old')
  const all = Promise.all([session.refresh(), session.refresh(), session.refresh()])
  release()
  assert.deepEqual(await all, ['access-5', 'access-5', 'access-5'])
  assert.deepEqual(calls, ['refresh:refresh-old'])
  await session.refresh()
  assert.equal(calls.length, 2, 'a later refresh is a new request')
})

test('signing out runs cleanups while the session still works, then removes everything', async () => {
  const { session, values, calls, cleared } = setup()
  await session.signIn({ username: 'asha.parent', password: 'not-a-real-password' })
  const before = cleared(), order: string[] = []
  session.registerCleanup(async () => { order.push('push-token:' + session.getAccessToken()) })
  session.registerCleanup(() => { throw new Error('a failing cleanup must not block signing out') })
  const removed = session.registerCleanup(() => { order.push('removed') }); removed()
  await session.signOut()
  assert.deepEqual(order, ['push-token:access-1'])
  assert.ok(calls.includes('logout:refresh-1:access-1'))
  assert.equal(values.size, 0)
  assert.equal(session.getAccessToken(), null)
  assert.deepEqual(session.getState(), { status: 'signed-out', user: null, notice: null, restorePending: false, welcomePending: false })
  assert.equal(cleared(), before + 1, 'the query cache is cleared')
})

test('signing out still clears the device when the server cannot be reached', async () => {
  const { session, values } = setup({ logout: async () => { throw apiError('offline') } })
  await session.signIn({ username: 'asha.parent', password: 'not-a-real-password' })
  await session.signOut()
  assert.equal(values.size, 0)
  assert.equal(session.getState().status, 'signed-out')
})

test('the account is kept current only while signed in, and expiry says why', async () => {
  const { session } = setup()
  session.updateUser({ ...user, roles: ['Teacher'] })
  assert.equal(session.getState().user, null)
  await session.signIn({ username: 'asha.parent', password: 'not-a-real-password' })
  session.updateUser({ ...user, permissions: [] })
  assert.deepEqual(session.getState().user?.permissions, [])
  session.welcomeShown()
  assert.equal(session.getState().welcomePending, false)
  await session.expire()
  assert.equal(session.getState().notice, SESSION_ENDED)
  assert.equal(session.getAccessToken(), null)
})
