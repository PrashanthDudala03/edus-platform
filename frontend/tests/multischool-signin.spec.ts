import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

// The sign-in school choice in a real browser with the whole API mocked: no service,
// database or account is needed. Pages are served from the local build (npm run build) when there is one.
const dist = resolve(process.cwd(), 'dist')
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }
const school = '11111111-1111-4111-8111-111111111111', other = '44444444-4444-4444-8444-444444444444'
const admin = { id: '33333333-3333-4333-8333-333333333333', username: 'meera.admin', email: 'meera@example.test', firstName: 'Meera', lastName: 'Rao', schoolId: school, roles: ['Administrator'], dataScope: 'school', permissions: ['overview.view', 'notifications.manage'] }
const teacher = { ...admin, id: '22222222-2222-4222-8222-222222222222', username: 'asha.teacher', firstName: 'Asha', roles: ['Teacher'], dataScope: 'teacher', permissions: ['circulars.view', 'leave-requests.view'] }
type Text = { title: string, body: string }
const reserved = ['push', 'email', 'whatsapp', 'sms'].map(channel => ({ channel, available: false, titleMax: 60, bodyMax: 160, default: null, override: null, source: 'default' }))
const template = (key: string, name: string, sending: boolean, standard: Text, variables: string[], own: (Text & { enabled: boolean, version: number }) | null = null) => ({
  key, event: name, name, description: 'Sent when: ' + name.toLowerCase() + '.', category: 'leave', status: sending ? 'IMPLEMENTED' : 'READY FOR PRODUCER', sending,
  variables: variables.map(v => ({ name: v, description: 'About ' + v, sample: 'Sample ' + v })),
  channels: [{ channel: 'in-app', available: true, titleMax: 200, bodyMax: 1000, default: standard, override: own && { ...own, updatedAt: '2026-10-02T06:00:00Z' }, source: own?.enabled ? 'school' : 'default' }, ...reserved],
})
const sent = '7c1d0000-0000-4000-8000-0000000000d1'
const approved: Text = { title: 'Your leave was approved', body: '{{dateRange}}. {{remark}}' }
type Call = { method: string, path: string, body: Record<string, unknown> | null }

async function mock(page: Page, user = admin, login?: (body: Record<string, string>) => { status: number, body: unknown }) {
  const calls: Call[] = []
  let own: (Text & { enabled: boolean, version: number }) | null = null
  const current = () => template('leave.approved', 'Leave approved', true, approved, ['teacherName', 'dateRange', 'remark'], own)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  if (!login) await page.addInitScript(([stored]) => { localStorage.setItem('accessToken', 'test-access-token'); localStorage.setItem('refreshToken', 'test-refresh-token'); localStorage.setItem('user', stored) }, [JSON.stringify(user)])
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.startsWith('/api/') ? url.pathname.replace('/api/v1', '') : '', method = request.method()
    if (url.pathname.startsWith('/api/') && method !== 'GET') calls.push({ method, path: path + url.search, body: request.postData() ? request.postDataJSON() : null })
    if (path === '/auth/login' && login) { const answer = login(request.postDataJSON()); return json(route, answer.body, answer.status) }
    if (path === '/control/me') return json(route, { data: user })
    if (path === '/notifications/templates') return user.permissions.includes('notifications.manage')
      ? json(route, { data: [template('circular.published', 'Circular published', true, { title: '{{circularTitle}}', body: '{{circularMessage}}' }, ['circularTitle', 'circularMessage']), current(), template('fee.due', 'Fee due', false, { title: 'Fee due: {{amount}}', body: 'Due on {{dueDate}}.' }, ['amount', 'dueDate'])] })
      : json(route, { message: 'Your role cannot manage notification wording.' }, 403)
    if (path === '/notifications/history') return user.permissions.includes('notifications.manage')
      ? json(route, { data: { items: [
        { id: sent, type: 'leave.approved', template: 'Leave approved', category: 'leave', title: 'Your leave was approved', source: 'suite.leave-requests', wording: 'school', wordingVersion: 3, createdAt: '2026-10-02T03:35:00Z', recipients: 1, read: 1, failed: 0, waiting: 0 },
        { id: other, type: 'circular.published', template: 'Circular published', category: 'notices', title: 'Parent-teacher meeting', source: 'suite.circulars', wording: 'default', wordingVersion: null, createdAt: '2026-10-01T03:35:00Z', recipients: 42, read: 17, failed: 2, waiting: 1 },
      ], totalCount: 2, page: 1, pageSize: 30 } })
      : json(route, { message: 'Your role cannot manage notification wording.' }, 403)
    if (path === '/notifications/history/' + sent) return json(route, { data: { notification: { id: sent, title: 'Your leave was approved' }, recipients: [{ name: 'Asha Rao', scope: 'teacher', read: true, channel: 'in-app', status: 'delivered', attempts: 0, lastError: null }] } })
    if (path === '/notifications/templates/leave.approved/preview') {
      const body = request.postDataJSON() as Text
      if (body.title.includes('{{password}}')) return json(route, { message: '{{password}} is not available for this notification.' }, 400)
      const fill = (text: string) => text.replace('{{teacherName}}', 'Ravi Kumar').replace('{{dateRange}}', '5 Oct 2026 to 7 Oct 2026').replace('{{remark}}', 'Please hand over your classes')
      return json(route, { data: { title: fill(body.title), body: fill(body.body) } })
    }
    if (path === '/notifications/templates/leave.approved' && method === 'PUT') { const body = request.postDataJSON() as Text; own = { title: body.title, body: body.body, enabled: true, version: (own?.version ?? 0) + 1 }; return json(route, { data: current(), message: "Your school's wording is saved." }) }
    if (path === '/notifications/templates/leave.approved/enabled') { own = { ...own!, enabled: (request.postDataJSON() as { enabled: boolean }).enabled, version: own!.version + 1 }; return json(route, { data: current(), message: own.enabled ? "Your school's wording is in use." : 'The EduOS default is in use.' }) }
    if (path === '/notifications/templates/leave.approved' && method === 'DELETE') { own = null; return json(route, { data: current(), message: 'Reset to the EduOS default.' }) }
    if (url.pathname.startsWith('/api/')) return json(route, { data: path.endsWith('/school') ? { name: 'Green Valley School' } : path === '/suite/home' ? { home: null, canManage: false } : [] })
    if (!existsSync(dist)) return route.continue()
    const file = join(dist, url.pathname), served = extname(url.pathname) && existsSync(file) ? file : join(dist, 'index.html')
    return route.fulfill({ status: 200, contentType: types[extname(served)] ?? 'application/octet-stream', body: readFileSync(served) })
  })
  return calls
}
const main = (page: Page) => page.locator('#main')

test.describe('Sign-in with one name in several schools', () => {
  const session = (schoolId: string) => ({ data: { accessToken: 'test-access-token', refreshToken: 'test-refresh-token', expiresIn: 900, user: { ...admin, schoolId } } })
  test('the schools are offered by name only after the password is accepted, and the choice is sent back', async ({ page }) => {
    const sent: Record<string, string>[] = []
    await mock(page, admin, body => {
      sent.push(body)
      if (body.password !== 'not-a-real-password') return { status: 401, body: { statusCode: 401, message: 'Invalid credentials' } }
      return body.schoolId ? { status: 200, body: session(body.schoolId) } : { status: 409, body: { statusCode: 409, message: 'Choose your school to continue.', schools: [{ id: school, name: 'Green Valley School' }, { id: other, name: 'Hillview Academy' }] } }
    })
    await page.goto('/login')
    await page.getByLabel('Email or username').fill('meera.admin')
    await page.getByLabel('Password', { exact: true }).fill('a-wrong-password')
    await page.getByRole('button', { name: 'Sign in to workspace' }).click()
    await expect(page.getByRole('alert')).toContainText('incorrect')
    await expect(page.getByRole('group', { name: 'Choose your school' })).toHaveCount(0)
    await page.getByLabel('Password', { exact: true }).fill('not-a-real-password')
    await page.getByRole('button', { name: 'Sign in to workspace' }).click()
    const choice = page.getByRole('group', { name: 'Choose your school' })
    await expect(choice.getByRole('button')).toHaveText(['Green Valley School', 'Hillview Academy'])
    await expect(choice).not.toContainText(other)
    await choice.getByRole('button', { name: 'Hillview Academy' }).click()
    await expect(page).not.toHaveURL(/login/)
    expect(sent.map(body => body.schoolId)).toEqual(['', '', other])
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('user')!).schoolId)).toBe(other)
  })
})
