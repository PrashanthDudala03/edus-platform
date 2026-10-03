import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

// Notification wording and the sign-in school choice in a real browser with the whole API mocked: no service,
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

test.describe('Notification wording', () => {
  test('an administrator sees every notification, its EduOS default and which ones are not sent yet', async ({ page }) => {
    await mock(page)
    await page.goto('/notifications/templates')
    await expect(page.getByRole('heading', { name: 'Notification wording' })).toBeVisible()
    const list = page.getByRole('region', { name: 'Notifications' })
    await expect(list.getByRole('button')).toHaveCount(3)
    await expect(list.getByRole('button', { name: /Fee due/ })).toContainText('not sent yet')
    await expect(list.getByRole('button', { name: /Circular published/ })).not.toContainText('not sent yet')
    await list.getByRole('button', { name: /Fee due/ }).click()
    await expect(main(page)).toContainText('EduOS does not send this notification yet')
    // Channels that do not deliver yet can be seen but not chosen.
    const options = page.getByLabel('Channel').locator('option')
    await expect(options).toHaveCount(5)
    await expect(options.filter({ hasText: 'not available yet' })).toHaveCount(4)
    for (const option of await options.filter({ hasText: 'not available yet' }).all()) await expect(option).toHaveAttribute('disabled', '')
    expect((await new AxeBuilder({ page }).include('#main').analyze()).violations).toEqual([])
    if (process.env.EDUOS_SHOTS) await page.screenshot({ path: process.env.EDUOS_SHOTS + '/templates.png', fullPage: true })
  })

  test('wording is previewed, saved for the school, switched off and reset to the default', async ({ page }) => {
    const calls = await mock(page)
    await page.goto('/notifications/templates')
    await page.getByRole('region', { name: 'Notifications' }).getByRole('button', { name: /Leave approved/ }).click()
    await expect(page.getByLabel('Title')).toHaveValue(approved.title)
    await expect(page.getByRole('button', { name: 'Reset to EduOS default' })).toHaveCount(0)
    await page.getByLabel('Title').fill('Leave approved for')
    await page.getByRole('button', { name: '{{teacherName}}' }).click()
    await expect(page.getByLabel('Title')).toHaveValue('Leave approved for {{teacherName}}')
    await page.getByRole('button', { name: 'Preview' }).click()
    const preview = page.getByRole('status', { name: 'Preview' })
    await expect(preview).toContainText('Leave approved for Ravi Kumar')
    await expect(preview).toContainText('5 Oct 2026 to 7 Oct 2026. Please hand over your classes')
    await page.getByRole('button', { name: 'Save for our school' }).click()
    await expect(main(page).getByText("Your school's wording is saved.")).toBeVisible()
    await expect(page.getByRole('region', { name: 'Notifications' }).getByRole('button', { name: /Leave approved/ })).toContainText("Your school's wording")
    await page.getByRole('button', { name: 'Use the EduOS default for now' }).click()
    await expect(main(page).getByText('The EduOS default is in use.')).toBeVisible()
    // The school's text is kept while switched off, ready to be used again.
    await expect(page.getByLabel('Title')).toHaveValue('Leave approved for {{teacherName}}')
    await expect(page.getByRole('button', { name: 'Use our wording' })).toBeVisible()
    await page.getByRole('button', { name: 'Reset to EduOS default' }).click()
    await expect(main(page).getByText('Reset to the EduOS default.')).toBeVisible()
    await expect(page.getByLabel('Title')).toHaveValue(approved.title)
    expect(calls.filter(call => !call.path.endsWith('/preview')).map(call => [call.method, call.path, call.body])).toEqual([
      ['PUT', '/notifications/templates/leave.approved', { channel: 'in-app', title: 'Leave approved for {{teacherName}}', body: approved.body }],
      ['PUT', '/notifications/templates/leave.approved/enabled', { channel: 'in-app', enabled: false }],
      ['DELETE', '/notifications/templates/leave.approved?channel=in-app', null],
    ])
  })

  test('a placeholder the server refuses is explained and nothing is saved', async ({ page }) => {
    const calls = await mock(page)
    await page.goto('/notifications/templates')
    await page.getByRole('region', { name: 'Notifications' }).getByRole('button', { name: /Leave approved/ }).click()
    await page.getByLabel('Title').fill('Hello {{password}}')
    await page.getByRole('button', { name: 'Preview' }).click()
    await expect(page.getByRole('alert')).toContainText('{{password}} is not available for this notification.')
    await expect(page.getByRole('status', { name: 'Preview' })).toHaveCount(0)
    expect(calls.filter(call => call.method !== 'POST')).toEqual([])
  })

  test('a teacher has no link to the page and cannot open it', async ({ page }) => {
    await mock(page, teacher)
    await page.goto('/notifications/templates')
    await expect(page.getByRole('heading', { name: 'Notification wording' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Notification wording' })).toHaveCount(0)
  })
})

test.describe('Notification history', () => {
  test('an administrator sees what was sent, the wording used and what happened, without contact details', async ({ page }) => {
    await mock(page)
    await page.goto('/notifications/templates')
    // Both pages are in the menu, together, for a role that may manage notifications.
    const group = page.getByRole('navigation', { name: 'Main navigation' }).locator('.nav-section', { hasText: 'Notifications' })
    await expect(group.getByRole('link')).toHaveText(['Notification wording', 'Delivery history'])
    await group.getByRole('link', { name: 'Delivery history' }).click()
    await expect(page.getByRole('heading', { name: 'Delivery history' })).toBeVisible()
    const rows = page.getByRole('region', { name: 'Sent notifications' }).locator('tbody tr')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText("Your school's (version 3)")
    await expect(rows.nth(0)).toContainText('1 of 1')
    await expect(rows.nth(0)).toContainText('Delivered')
    await expect(rows.nth(1)).toContainText('EduOS default')
    await expect(rows.nth(1)).toContainText('17 of 42')
    await expect(rows.nth(1)).toContainText('2 failed, 1 waiting')
    await rows.nth(0).getByRole('button', { name: 'Leave approved' }).click()
    const people = page.getByRole('region', { name: 'Recipients' })
    await expect(people.locator('tbody tr')).toHaveText([/Asha Rao.*teacher.*Read.*In-app inbox.*delivered/])
    await expect(main(page)).not.toContainText('@')
    expect((await new AxeBuilder({ page }).include('#main').analyze()).violations).toEqual([])
  })

  test('a teacher cannot open it', async ({ page }) => {
    await mock(page, teacher)
    await page.goto('/notifications/history')
    await expect(page.getByRole('heading', { name: 'Delivery history' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Delivery history' })).toHaveCount(0)
  })

  test('an administrator whose school has not been given the permission yet sees no notification menu', async ({ page }) => {
    // This is the running system today: the permission is issued by the notification deployment, not by the web app.
    await mock(page, { ...admin, permissions: ['overview.view', 'school-home.manage', 'school.settings.manage'] })
    await page.goto('/suite')
    await expect(page.getByRole('link', { name: 'School Home management' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Notification wording' })).toHaveCount(0)
    await page.goto('/notifications/templates')
    await expect(page.getByRole('heading', { name: 'Notification wording' })).toHaveCount(0)
  })
})
