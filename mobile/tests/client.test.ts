import test from 'node:test'
import assert from 'node:assert/strict'
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { createApiClient } from '../src/api/client.ts'
import { apiError, normalizeError } from '../src/api/errors.ts'
import { checkApiUrl } from '../src/api/url.ts'

type Reply = { status: number, data?: unknown }
// A stand-in for the network: answers from a function and records what was sent.
function network(answer: (config: InternalAxiosRequestConfig) => Reply | Promise<Reply>) {
  const sent: { url: string, authorization: string | undefined, params: unknown }[] = []
  const adapter: AxiosAdapter = async config => {
    sent.push({ url: String(config.url), authorization: config.headers.Authorization as string | undefined, params: config.params })
    const reply = await answer(config), response = { status: reply.status, statusText: '', data: reply.data, headers: {}, config } as AxiosResponse
    if (reply.status >= 200 && reply.status < 300) return response
    throw Object.assign(new Error('Request failed with status code ' + reply.status), { isAxiosError: true, config, response })
  }
  return { adapter, sent }
}
function sessionStub(token: string | null = 'access-1') {
  const log = { refreshes: 0, expired: 0 }
  let current = token
  return { log, getAccessToken: () => current, refresh: async () => { log.refreshes++; current = 'access-' + (log.refreshes + 1); return current }, expire: async () => { log.expired++; current = null } }
}

test('requests carry the access token and never a school id of their own', async () => {
  const { adapter, sent } = network(() => ({ status: 200, data: { data: [] } })), session = sessionStub()
  const client = createApiClient({ baseURL: 'https://eduos.test/api/v1', session, adapter })
  await client.get('/suite/reports/attendance', { params: { month: '2026-10' } })
  assert.equal(sent[0].authorization, 'Bearer access-1')
  assert.deepEqual(sent[0].params, { month: '2026-10' })
  assert.ok(!JSON.stringify(sent[0]).toLowerCase().includes('schoolid'))
})

test('an expired access token is refreshed once, shared by concurrent requests, and each request is repeated', async () => {
  const session = sessionStub()
  const { adapter, sent } = network(config => config.headers.Authorization === 'Bearer access-1' ? { status: 401 } : { status: 200, data: { data: config.url } })
  const client = createApiClient({ baseURL: 'https://eduos.test/api/v1', session, adapter })
  const results = await Promise.all([client.get('/a'), client.get('/b'), client.get('/c')])
  assert.deepEqual(results.map(r => r.data.data), ['/a', '/b', '/c'])
  assert.equal(session.log.expired, 0)
  assert.equal(sent.filter(s => s.authorization === 'Bearer access-1').length, 3)
  assert.equal(sent.filter(s => s.authorization !== 'Bearer access-1').length, 3, 'each request is repeated exactly once with the new token')
})

test('when the refresh is refused the session ends and the caller gets a clear error', async () => {
  const session = { ...sessionStub(), refresh: async () => { throw apiError('unauthorized') } }
  const { adapter } = network(() => ({ status: 401 }))
  const client = createApiClient({ baseURL: 'https://eduos.test/api/v1', session, adapter })
  await assert.rejects(client.get('/suite/home'), { kind: 'unauthorized', message: 'Your session has ended. Please sign in again.' })
  assert.equal(session.log.expired, 1)
})

test('losing the connection during a refresh does not end the session', async () => {
  const session = { ...sessionStub(), refresh: async () => { throw apiError('offline') } }
  const { adapter } = network(() => ({ status: 401 }))
  const client = createApiClient({ baseURL: 'https://eduos.test/api/v1', session, adapter })
  await assert.rejects(client.get('/suite/home'), { kind: 'offline', retryable: true })
  assert.equal(session.log.expired, 0)
})

test('a request refused again after refreshing ends the session instead of looping', async () => {
  const session = sessionStub(), { adapter, sent } = network(() => ({ status: 401 }))
  const client = createApiClient({ baseURL: 'https://eduos.test/api/v1', session, adapter })
  await assert.rejects(client.get('/suite/home'), { kind: 'unauthorized' })
  assert.equal(sent.length, 2)
  assert.equal(session.log.refreshes, 1)
  assert.equal(session.log.expired, 1)
})

test('403 is reported as a refusal: no refresh, no sign-out', async () => {
  const session = sessionStub(), { adapter, sent } = network(() => ({ status: 403, data: { message: 'Permission denied.' } }))
  const client = createApiClient({ baseURL: 'https://eduos.test/api/v1', session, adapter })
  await assert.rejects(client.get('/operations/overview'), { kind: 'forbidden', status: 403, message: 'Permission denied.', retryable: false })
  assert.equal(sent.length, 1)
  assert.deepEqual(session.log, { refreshes: 0, expired: 0 })
})

test('errors are normalised whatever shape the service used', () => {
  const http = (status: number, data?: unknown) => ({ response: { status, data } })
  assert.deepEqual(normalizeError(http(400, { statusCode: 400, message: 'Validation failed', errors: [{ field: 'Username', message: 'Username is required.' }, { field: 'Password', message: 'Password is required.' }] })),
    { kind: 'validation', status: 400, message: 'Username is required. Password is required.', fields: { Username: 'Username is required.', Password: 'Password is required.' }, retryable: false })
  assert.equal(normalizeError(http(409, { message: 'This record changed since you opened it. Refresh before saving.' })).message, 'This record changed since you opened it. Refresh before saving.')
  assert.deepEqual(normalizeError(http(429, '<html>Too Many Requests</html>')), { kind: 'rate-limited', status: 429, message: 'Too many attempts. Wait a minute and try again.', retryable: true })
  assert.equal(normalizeError(http(404)).kind, 'not-found')
  assert.deepEqual(normalizeError({ code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' }), { kind: 'timeout', message: 'EduOS took too long to respond. Try again.', retryable: true })
  assert.equal(normalizeError({ code: 'ERR_NETWORK', message: 'Network Error' }).kind, 'offline')
  assert.equal(normalizeError(undefined).kind, 'unknown')
  const same = apiError('forbidden'); assert.equal(normalizeError(same), same)
})

test('server internals never reach the screen', () => {
  for (const message of ['Unhandled exception: Npgsql.PostgresException at db.internal:5432', 'System.NullReferenceException at Suite.Home.cs:line 12', 'x'.repeat(400)]) {
    assert.equal(normalizeError({ response: { status: 500, data: { message } } }).message, 'EduOS could not complete this just now. Try again shortly.')
    assert.equal(normalizeError({ response: { status: 403, data: { message } } }).message, 'Your account does not have access to this.')
  }
})

test('the API address must be reachable from a phone and secure outside development', () => {
  assert.deepEqual(checkApiUrl(' https://school.example/api/v1/ ', false), { url: 'https://school.example/api/v1', problem: null })
  assert.equal(checkApiUrl('http://192.168.1.20:8080/api/v1', true).problem, null)
  assert.match(checkApiUrl('http://192.168.1.20:8080/api/v1', false).problem!, /HTTPS/)
  assert.match(checkApiUrl('http://localhost:8080/api/v1', true).problem!, /localhost/)
  assert.match(checkApiUrl(undefined, true).problem!, /not set/)
  assert.match(checkApiUrl('school.example', true).problem!, /valid/)
})
