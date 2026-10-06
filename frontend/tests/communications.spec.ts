import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

// Communication 2.0 and the notification inbox in a real browser with the API mocked: a principal composes and
// publishes to the parents of one class, schedules another, reads what happened and who is outstanding; a parent
// reads, opens and acknowledges once from the feed and the inbox; a teacher is limited to their class; the layout holds
// from 1440px to 360px. No service, database or account is touched.
const dist = resolve(process.cwd(), 'dist')
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }
const school = '11111111-1111-4111-8111-111111111111', C1 = 'cccccccc-0000-4000-8000-000000000001', C2 = 'cccccccc-0000-4000-8000-000000000002', K1 = 'dddddddd-0000-4000-8000-000000000001', K2 = 'dddddddd-0000-4000-8000-000000000002', N1 = 'eeeeeeee-0000-4000-8000-000000000001'
const principal = { id: '33333333-3333-4333-8333-333333333333', username: 'meera', email: 'm@example.test', firstName: 'Meera', lastName: 'Iyer', schoolId: school, roles: ['Principal'], dataScope: 'school', permissions: ['overview.view', 'circulars.view', 'circulars.manage', 'circulars.acknowledge', 'classes.view'] }
const teacher = { ...principal, id: '22222222-2222-4222-8222-222222222222', username: 'asha', firstName: 'Asha', roles: ['Teacher'], dataScope: 'teacher', permissions: ['circulars.view', 'circulars.manage', 'circulars.acknowledge', 'classes.view', 'attendance.view'] }
const parent = { ...principal, id: '44444444-4444-4444-8444-444444444444', username: 'neha', firstName: 'Neha', roles: ['Parent'], dataScope: 'parent', permissions: ['reports.view', 'circulars.view', 'circulars.acknowledge', 'fees.view'] }
type Call = { method: string, path: string, body: Record<string, unknown> | null }
type Row = Record<string, any>

async function mock(page: Page, user = principal) {
  const calls: Call[] = []; let acknowledged: string | null = null, read: string | null = null, inboxRead = false
  const records: Record<string, Row> = {
    [K1]: { id: K1, version: 2, title: 'Severe weather: school closed tomorrow', message: 'Due to the storm warning, the school stays closed on Friday.\nStay safe.', type: 'Alert', priority: 'Urgent', status: 'Published', audience: 'Parent', classId: C1, className: 'Grade 8 - A', audienceLabel: 'Parents of Grade 8 - A', publishAt: '', publishedAt: '2026-10-05T09:00:00Z', expiresOn: '', expired: false, requiresAcknowledgement: true, acknowledgeBy: '2026-10-07', authorId: principal.id, createdAt: '2026-10-05T08:00:00Z', counts: { intended: 31, notified: 31, read: 20, acknowledged: 12, failed: 0, outstanding: 19 } },
    [K2]: { id: K2, version: 1, title: 'Sports day volunteers', message: 'We need parent volunteers.', type: 'Notice', priority: 'Normal', status: 'Scheduled', audience: 'Parent', classId: '', className: '', audienceLabel: 'All parents', publishAt: '2030-10-07T03:30:00Z', publishedAt: '', expiresOn: '', expired: false, requiresAcknowledgement: false, acknowledgeBy: '', authorId: principal.id, createdAt: '2026-10-05T08:00:00Z', counts: { intended: 0, notified: 0, read: 0, acknowledged: 0, failed: 0, outstanding: null } },
  }
  const detail = (id: string) => ({ ...records[id], history: [{ from: '', to: 'Draft', by: principal.id, at: '2026-10-05T08:00:00Z', reason: '' }, ...(records[id].status === 'Published' ? [{ from: 'Draft', to: 'Published', by: principal.id, at: records[id].publishedAt, reason: '' }] : [])], snapshot: records[id].status === 'Published' ? { count: records[id].counts.intended, at: records[id].publishedAt, audience: records[id].audienceLabel } : null, cancelReason: '', canUrgent: user.dataScope === 'school' })
  const workspace = (status: string | null) => { const all = Object.values(records); const items = all.filter(r => !status || r.status === status); return { items, counts: Object.fromEntries(['Draft', 'Scheduled', 'Published', 'Archived', 'Cancelled'].map(s => [s, all.filter(r => r.status === s).length])), total: items.length, page: 1, pageSize: 25, canUrgent: user.dataScope === 'school', schoolWide: user.dataScope === 'school' } }
  const feed = () => ({ items: [{ ...records[K1], readAt: read, acknowledgedAt: acknowledged, canAcknowledge: user.permissions.includes('circulars.acknowledge') }], total: 1, page: 1, pageSize: 25, acknowledgementsDue: acknowledged ? 0 : 1 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(([stored]) => { localStorage.setItem('accessToken', 't'); localStorage.setItem('refreshToken', 'r'); localStorage.setItem('user', stored); localStorage.setItem('eduos.skipSchoolHome', '1') }, [JSON.stringify(user)])
  const json = (route: Route, body: unknown, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.startsWith('/api/') ? url.pathname.replace('/api/v1', '') : '', method = req.method()
    if (path && method !== 'GET') calls.push({ method, path, body: req.postData() ? req.postDataJSON() : null })
    if (path === '/control/me') return json(route, { data: user })
    if (path === '/suite/options') return json(route, { data: { classes: user.dataScope === 'teacher' ? [{ id: C1, label: 'Grade 8 - A (2026-27)' }] : [{ id: C1, label: 'Grade 8 - A (2026-27)' }, { id: C2, label: 'Grade 8 - B (2026-27)' }] } })
    if (path === '/suite/communications') return user.permissions.includes('circulars.manage') ? json(route, { data: workspace(url.searchParams.get('status')) }) : json(route, { message: 'Your role cannot manage communications.' }, 403)
    if (path === '/suite/communications/attention') return json(route, { data: { scheduled: [records[K2]], recent: [records[K1]], urgent: [records[K1]], outstanding: [records[K1]], deliveries: { failed: 0, waiting: 0, channels: ['in-app'] } } })
    if (path === '/suite/communications/audience') { const b = req.postDataJSON(); if (user.dataScope === 'teacher' && b.classId !== C1) return json(route, { message: 'Teachers address the families of one of their classes.' }, 403); return json(route, { data: { count: b.classId ? 31 : 412, label: b.classId ? 'Parents of Grade 8 - A' : 'All parents' } }) }
    if (path === '/suite/communications/feed') return json(route, { data: feed() })
    if (path === '/suite/communications/' + K1 + '/acknowledgements') return json(route, { data: { acknowledged: [{ name: 'Rohan Mehta', scope: 'parent', at: '2026-10-05T10:00:00Z' }], outstanding: [{ name: 'Neha Sharma', scope: 'parent', read: true }, { name: 'Vikram Rao', scope: 'parent', read: false }], intended: 31, requiresAcknowledgement: true } })
    if (path === '/suite/communications/' + K1 + '/read') { read = '2026-10-06T09:00:00Z'; return json(route, { data: { readAt: read } }) }
    if (path === '/suite/circulars/' + K1 + '/acknowledge') { acknowledged = acknowledged ?? '2026-10-06T09:01:00Z'; return json(route, { message: 'Acknowledgement recorded.' }) }
    const move = path.match(/^\/suite\/communications\/([^/]+)\/(publish|schedule|unschedule|cancel|archive)$/)
    if (move && method === 'POST') { const r = records[move[1]], b = req.postDataJSON(); if (!r) return json(route, { message: 'Record not found in this school.' }, 404); if (b.version !== r.version) return json(route, { message: 'This record changed since you opened it.' }, 409)
      r.status = move[2] === 'publish' ? 'Published' : move[2] === 'schedule' ? 'Scheduled' : move[2] === 'unschedule' ? 'Draft' : move[2] === 'cancel' ? 'Cancelled' : 'Archived'; r.version++; if (move[2] === 'publish') { r.publishedAt = '2026-10-06T09:05:00Z'; r.counts = { ...r.counts, intended: 412, notified: 410 } } if (move[2] === 'schedule') r.publishAt = b.publishAt
      return json(route, { data: detail(move[1]), message: r.status + '.' }) }
    if (path.startsWith('/suite/communications/')) { const id = path.split('/')[3]; return records[id] ? json(route, { data: detail(id) }) : json(route, { message: 'Record not found in this school.' }, 404) }
    if (path === '/suite/records/circulars' && method === 'POST') { const b = req.postDataJSON(); if (user.dataScope === 'teacher' && (b.classId !== C1 || !['Parent', 'Student', 'Family'].includes(b.audience))) return json(route, { message: 'Teachers may address the families of their own classes only.' }, 403)
      const id = 'ffffffff-0000-4000-8000-00000000000' + (Object.keys(records).length + 1); records[id] = { id, version: 1, ...b, className: b.classId === C1 ? 'Grade 8 - A' : '', audienceLabel: b.classId ? 'Parents of Grade 8 - A' : 'All parents', publishedAt: b.status === 'Published' ? '2026-10-06T09:05:00Z' : '', expired: false, requiresAcknowledgement: b.requiresAcknowledgement === 'Yes', acknowledgeBy: b.dueDate, authorId: user.id, createdAt: '2026-10-06T09:05:00Z', counts: { intended: b.status === 'Published' ? 31 : 0, notified: b.status === 'Published' ? 31 : 0, read: 0, acknowledged: 0, failed: 0, outstanding: b.requiresAcknowledgement === 'Yes' ? 31 : null } }
      return json(route, { data: { id } }, 201) }
    if (path === '/suite/documents') return json(route, { data: [] })
    if (path === '/notifications/unread-count') return json(route, { data: { unread: inboxRead ? 0 : 3 } })
    if (path === '/notifications' && method === 'GET') return json(route, { data: { items: [{ id: N1, type: 'circular.published', category: 'notices', title: 'Urgent: Severe weather: school closed tomorrow', body: 'Due to the storm warning, the school stays closed on Friday.', destination: { route: 'notices', entityId: K1 }, createdAt: '2026-10-05T09:00:00Z', readAt: inboxRead ? '2026-10-06T09:00:00Z' : null },
      { id: 'eeeeeeee-0000-4000-8000-000000000002', type: 'result.published', category: 'results', title: 'Results published: Term 1', body: 'Mathematics results for Grade 8 - A are available.', destination: { route: 'results', entityId: 'x' }, createdAt: '2026-10-04T09:00:00Z', readAt: '2026-10-04T10:00:00Z' }], unread: inboxRead ? 0 : 3, totalCount: 2, page: 1, pageSize: 30 } })
    if (path === '/notifications/' + N1 + '/read') { inboxRead = true; return json(route, { data: { unread: 0 } }) }
    if (path === '/notifications/read-all') { inboxRead = true; return json(route, { data: { unread: 0 } }) }
    if (path.startsWith('/suite/records/')) return json(route, { data: { data: [], totalCount: 0 } })
    if (path) return json(route, { data: path.endsWith('/school') ? { name: 'Green Valley School' } : [] })
    if (!existsSync(dist)) return route.continue()
    const file = join(dist, url.pathname), served = extname(url.pathname) && existsSync(file) ? file : join(dist, 'index.html')
    return route.fulfill({ status: 200, contentType: types[extname(served)] ?? 'application/octet-stream', body: readFileSync(served) })
  })
  return calls
}
const main = (page: Page) => page.locator('#main')
const dialog = (page: Page) => page.locator('dialog.modal')
const axe = async (page: Page) => (await new AxeBuilder({ page }).include('#main').analyze()).violations.flatMap(v => v.nodes.map(n => v.id + ' ' + n.target.join(' ')))
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)

test.describe('Communication 2.0', () => {
  test('a principal composes an urgent communication for the parents of one class and publishes it once', async ({ page }) => {
    const calls = await mock(page)
    await page.goto('/suite/communications')
    await expect(page.getByRole('heading', { name: 'Communications', exact: true })).toBeVisible()
    await expect(main(page).getByRole('region', { name: 'Needs attention' })).toContainText('Awaiting acknowledgement')
    expect(await axe(page)).toEqual([])
    await main(page).getByRole('button', { name: 'New communication' }).click()
    const d = dialog(page)
    await d.getByLabel('Title').fill('Severe weather: school closed on Monday'); await d.getByLabel('Message').fill('The school stays closed on Monday. Please acknowledge.'); await d.getByLabel('Type').selectOption('Alert')
    await d.getByRole('button', { name: 'Next' }).click()
    await d.getByLabel('Audience', { exact: true }).selectOption('Parent'); await d.getByLabel('Class', { exact: true }).selectOption(C1)
    await d.getByRole('button', { name: 'Next' }).click()
    await d.getByLabel('Priority').selectOption('Urgent'); await d.getByLabel('Ask each recipient to acknowledge').check(); await d.getByLabel('Publish now').check()
    await d.getByRole('button', { name: 'Next' }).click()
    await expect(d).toContainText('Parents of Grade 8 - A · 31 people')
    await expect(d).toContainText('Urgent')
    await d.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Severe weather: school closed on Monday' })).toBeVisible()
    await expect(main(page)).toContainText('Published')
    const created = calls.filter(c => c.path === '/suite/records/circulars')
    expect(created.length).toBe(1)
    expect(created[0].body).toEqual({ title: 'Severe weather: school closed on Monday', message: 'The school stays closed on Monday. Please acknowledge.', type: 'Alert', priority: 'Urgent', audience: 'Parent', classId: C1, requiresAcknowledgement: 'Yes', dueDate: '', expiresOn: '', status: 'Published', publishAt: '' })
    // The audience preview never carries people, only the server-resolved count.
    expect(calls.filter(c => c.path === '/suite/communications/audience').every(c => Object.keys(c.body!).sort().join() === 'audience,classId')).toBe(true)
  })

  test('the workspace shows what happened to a published communication and who has not acknowledged, without contact details', async ({ page }) => {
    await mock(page)
    await page.goto('/suite/communications?id=' + K1)
    await expect(page.getByRole('heading', { name: 'Severe weather: school closed tomorrow' })).toBeVisible()
    await expect(main(page)).toContainText('20 of 31 read · 12 acknowledged · 19 outstanding')
    await expect(main(page)).toContainText('Audience at publication: Parents of Grade 8 - A, 31 people')
    await main(page).getByRole('button', { name: 'Who has not acknowledged' }).click()
    await expect(main(page)).toContainText('Vikram Rao'); await expect(main(page)).toContainText('Unread')
    await expect(main(page)).not.toContainText('@'); expect(await main(page).innerText()).not.toMatch(/\b9\d{9}\b/)
    await expect(main(page).getByRole('button', { name: 'Publish now' })).toHaveCount(0)
    await expect(main(page).getByRole('button', { name: 'Archive' })).toBeVisible()
    expect(await axe(page)).toEqual([])
  })

  test('a scheduled communication can be published now, and publishing twice sends one request', async ({ page }) => {
    const calls = await mock(page)
    await page.goto('/suite/communications?id=' + K2)
    await expect(main(page)).toContainText('Goes out')
    await main(page).getByRole('button', { name: 'Publish now' }).click()
    const d = dialog(page); await expect(d).toContainText('places one notification in each person’s inbox')
    await d.getByRole('button', { name: 'Publish now' }).click()
    await expect(main(page).getByRole('status')).toContainText('Published.')
    await expect(main(page).getByRole('button', { name: 'Publish now' })).toHaveCount(0)
    expect(calls.filter(c => c.path.endsWith('/publish')).map(c => c.body)).toEqual([{ version: 1, reason: '' }])
  })

  test('a teacher may address only their own class families and cannot see the leadership summary', async ({ page }) => {
    const calls = await mock(page, teacher)
    await page.goto('/suite/communications')
    await expect(main(page).getByRole('region', { name: 'Needs attention' })).toHaveCount(0)
    await main(page).getByRole('button', { name: 'New communication' }).click()
    const d = dialog(page)
    await d.getByLabel('Title').fill('Homework diary'); await d.getByLabel('Message').fill('Please sign the diary every evening.')
    await d.getByRole('button', { name: 'Next' }).click()
    await expect(d.getByLabel('Audience', { exact: true }).locator('option')).toHaveText(['Parents', 'Students', 'Parents and students'])
    await d.getByRole('button', { name: 'Next' }).click()
    await expect(d.getByLabel('Priority').locator('option')).toHaveText(['Normal', 'Important'])
    await d.getByRole('button', { name: 'Next' }).click()
    // The review lists the blockers; the server's own refusal of the audience preview may show beside it, so name the list.
    await expect(d.locator('ul[role=alert]')).toContainText('Choose one of your classes.')
    await expect(d.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled()
    await d.getByRole('button', { name: 'Back' }).click(); await d.getByRole('button', { name: 'Back' }).click()
    await d.getByLabel('Class', { exact: true }).selectOption(C1)
    await d.getByRole('button', { name: 'Next' }).click(); await d.getByRole('button', { name: 'Next' }).click()
    await expect(d).toContainText('31 people')
    await d.getByRole('button', { name: 'Publish', exact: true }).click()
    expect(calls.filter(c => c.path === '/suite/records/circulars').map(c => [c.body!.audience, c.body!.classId])).toEqual([['Parent', C1]])
  })

  test('a parent reads, opens and acknowledges once from the feed, and the inbox bell leads to the same notice', async ({ page }) => {
    const calls = await mock(page, parent)
    await page.goto('/suite/communications')
    await expect(page.getByRole('heading', { name: 'Notices & circulars' })).toBeVisible()
    await expect(main(page).getByRole('button', { name: 'New communication' })).toHaveCount(0)
    await expect(main(page)).toContainText('1 to acknowledge')
    expect(await axe(page)).toEqual([])
    await main(page).getByRole('button', { name: /Severe weather/ }).click()
    const d = dialog(page)
    await expect(d).toContainText('Stay safe.')
    await d.getByRole('button', { name: 'Acknowledge' }).click()
    await expect(d.getByRole('status')).toContainText('You acknowledged this')
    await expect(d.getByRole('button', { name: 'Acknowledge' })).toHaveCount(0)
    expect(calls.filter(c => c.path.endsWith('/read')).length).toBe(1)
    expect(calls.filter(c => c.path.endsWith('/acknowledge')).length).toBe(1)
    // The bell and the inbox.
    await d.getByRole('button', { name: 'Close dialog' }).click(); await expect(d).toHaveCount(0)
    const bell = page.getByRole('link', { name: 'Notifications, 3 unread' }); await expect(bell).toBeVisible()
    await bell.click()
    await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible()
    const rows = main(page).getByRole('region', { name: 'Your notifications' }).getByRole('listitem')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('Notices'); await expect(rows.nth(0)).toContainText('Urgent: Severe weather')
    await expect(main(page)).not.toContainText('circular.published')
    expect(await axe(page)).toEqual([])
    await rows.nth(0).getByRole('button').click()
    await expect(page).toHaveURL(new RegExp('/suite/communications\\?open=' + K1))
    await expect(dialog(page)).toContainText('Stay safe.')
    expect(calls.filter(c => c.path === '/notifications/' + N1 + '/read').length).toBe(1)
  })

  test('mark all as read clears the bell', async ({ page }) => {
    const calls = await mock(page, parent)
    await page.goto('/notifications')
    await main(page).getByRole('button', { name: 'Mark all as read' }).click()
    await expect(main(page).getByRole('button', { name: 'Mark all as read' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Notifications', exact: true })).toBeVisible()
    expect(calls.map(c => c.path)).toEqual(['/notifications/read-all'])
  })

  for (const width of [1440, 1024, 768, 390, 360]) test(`at ${width}px the workspace, the detail, the feed and the inbox fit without sideways scrolling`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await mock(page)
    await page.goto('/suite/communications'); await expect(main(page)).toContainText('Severe weather'); expect(await noSideways(page)).toBe(true)
    await page.goto('/suite/communications?id=' + K1); await expect(main(page)).toContainText('Audience at publication'); expect(await noSideways(page)).toBe(true)
    await page.goto('/notifications'); await expect(main(page)).toContainText('Results published'); expect(await noSideways(page)).toBe(true)
  })

  test('at 390px a parent reads and acknowledges from the feed without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mock(page, parent)
    await page.goto('/suite/communications'); await expect(main(page)).toContainText('To acknowledge'); expect(await noSideways(page)).toBe(true)
    await main(page).getByRole('button', { name: /Severe weather/ }).click(); await expect(dialog(page)).toContainText('Stay safe.')
    expect(await noSideways(page)).toBe(true)
  })
})
