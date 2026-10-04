import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

// Leave & Approvals 2.0 in a real browser with the API mocked: a teacher reads balances and submits a request;
// leadership works the queue with the balance and the timetable impact and decides with a remark. No service,
// database or real leave is involved.
const dist = resolve(process.cwd(), 'dist')
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }
const school = '11111111-1111-4111-8111-111111111111'
const principal = { id: '22222222-2222-4222-8222-222222222222', username: 'meera', email: 'm@example.test', firstName: 'Meera', lastName: 'Nair', schoolId: school, roles: ['Principal'], dataScope: 'school', permissions: ['leave-requests.view', 'leave-requests.manage', 'leave-requests.approve', 'leave-adjustments.view', 'leave-adjustments.manage', 'substitutions.view', 'substitutions.manage', 'timetable.view', 'leave-types.view'] }
const teacher = { ...principal, id: '33333333-3333-4333-8333-333333333333', username: 'maya', firstName: 'Maya', lastName: 'Teacher', roles: ['Teacher'], dataScope: 'teacher', permissions: ['leave-requests.view', 'leave-requests.manage', 'timetable.view', 'leave-types.view'] }
const T1 = 'tttttttt-0000-4000-8000-000000000001', CL = 'yyyyyyyy-0000-4000-8000-000000000001', LV = 'llllllll-0000-4000-8000-000000000009'
type Call = { method: string, path: string, body: Record<string, unknown> | null }
const balance = (pending: number, used: number) => ({ teacherId: T1, teacherName: 'Maya Teacher', year: { name: '2026-27', from: '2026-04-01', to: '2027-03-31' }, adjustments: [], balances: [
  { typeId: CL, name: 'Casual leave', code: 'CL', paid: 'Paid', tracksBalance: true, active: true, year: '2026-27', allowance: 12, added: 0, deducted: 0, used, pending, remaining: 12 - used, afterPending: 12 - used - pending },
  { typeId: 'ul', name: 'Unpaid leave', code: 'UL', paid: 'Unpaid', tracksBalance: false, active: true, year: '2026-27', allowance: 0, added: 0, deducted: 0, used: 0, pending: 0, remaining: null, afterPending: null }] })
const request = (status: string) => ({ id: LV, version: 1, teacherId: T1, typeId: CL, fromDate: '2026-10-12', toDate: '2026-10-13', halfDay: 'No', reason: 'Family function', status, approvalRemark: status === 'Approved' ? 'Enjoy' : '', days: 2, createdAt: '2026-10-01T09:00:00Z' })

async function mock(page: Page, user = principal) {
  const calls: Call[] = []; let status = 'Pending'
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(([stored]) => { localStorage.setItem('accessToken', 'test-access-token'); localStorage.setItem('refreshToken', 'test-refresh-token'); localStorage.setItem('user', stored); localStorage.setItem('eduos.skipSchoolHome', '1') }, [JSON.stringify(user)])
  const json = (route: Route, body: unknown, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.startsWith('/api/') ? url.pathname.replace('/api/v1', '') : '', method = req.method()
    if (path && method !== 'GET') calls.push({ method, path, body: req.postData() ? req.postDataJSON() : null })
    if (path === '/control/me') return json(route, { data: user })
    if (path === '/suite/options') return json(route, { data: { teachers: [{ id: T1, label: 'Maya Teacher' }], 'leave-types': [{ id: CL, label: 'Casual leave' }, { id: 'ul', label: 'Unpaid leave' }] } })
    if (path === '/suite/leave/balances') return json(route, { data: balance(status === 'Pending' ? 2 : 0, status === 'Approved' ? 2 : 0) })
    if (path === '/suite/leave/queue') return json(route, { data: { items: status === 'Pending' ? [{ ...request('Pending'), teacherName: 'Maya Teacher', typeName: 'Casual leave', remaining: 12, tracksBalance: true, impact: { affected: 3, covered: 1, uncovered: 2 } }] : [], total: status === 'Pending' ? 1 : 0, canApprove: true } })
    if (path === '/suite/leave/' + LV + '/impact') return json(route, { data: { leaveId: LV, teacherId: T1, teacherName: 'Maya Teacher', fromDate: '2026-10-12', toDate: '2026-10-13', halfDay: 'No', days: 2, dates: ['2026-10-12', '2026-10-13'], summary: { affected: 3, covered: 1, uncovered: 2 }, periods: [{ id: 'p1', date: '2026-10-12', day: 'Monday', startsAt: '09:00', endsAt: '09:45', className: 'Grade 6 - A', subjectName: 'Science', room: 'Lab 1', status: 'covered', substitution: { id: 's', teacherName: 'Nila Cover' } }, { id: 'p2', date: '2026-10-12', day: 'Monday', startsAt: '11:00', endsAt: '11:45', className: 'Grade 7 - B', subjectName: 'Science', room: '', status: 'uncovered' }, { id: 'p1', date: '2026-10-13', day: 'Tuesday', startsAt: '09:00', endsAt: '09:45', className: 'Grade 6 - A', subjectName: 'Science', room: 'Lab 1', status: 'uncovered' }] } })
    if (path === '/suite/leave/' + LV + '/decision' && method === 'POST') { status = String(req.postDataJSON().decision); return json(route, { data: { id: LV } }) }
    if (path === '/suite/leave/' + LV + '/cancel' && method === 'POST') { status = 'Cancelled'; return json(route, { data: { id: LV } }) }
    if (path === '/suite/records/leave-requests' && method === 'POST') return json(route, { data: { id: 'new' } }, 201)
    if (path === '/suite/records/leave-requests') return json(route, { data: { data: [request(status)], totalCount: 1 } })
    if (path === '/suite/timetable/operations') return json(route, { data: { date: '2026-10-05', day: 'Monday', away: [], periods: [], summary: { away: 0, affected: 0, covered: 0, uncovered: 0 } } })
    if (path.startsWith('/suite/records/')) return json(route, { data: { data: [], totalCount: 0 } })
    if (path) return json(route, { data: [] })
    if (!existsSync(dist)) return route.continue()
    const file = join(dist, url.pathname), served = extname(url.pathname) && existsSync(file) ? file : join(dist, 'index.html')
    return route.fulfill({ status: 200, contentType: types[extname(served)] ?? 'application/octet-stream', body: readFileSync(served) })
  })
  return calls
}
const main = (page: Page) => page.locator('#main')
const axe = async (page: Page) => (await new AxeBuilder({ page }).include('#main').analyze()).violations.flatMap(v => v.nodes.map(n => v.id + ' ' + n.target.join(' ')))

test.describe('Leave & Approvals 2.0', () => {
  test('leadership sees the balance and timetable impact in the queue, reads the impact, and approves with a remark', async ({ page }) => {
    const calls = await mock(page)
    await page.goto('/suite/leave-requests')
    await expect(page.getByRole('heading', { name: 'Leave approvals' })).toBeVisible()
    await expect(main(page)).toContainText('Maya Teacher · 2026-10-12 to 2026-10-13 · 2 day(s)')
    await expect(main(page)).toContainText('Casual leave · 12 left · 2 of 3 lessons still need cover')
    expect(await axe(page)).toEqual([])
    await main(page).getByRole('button', { name: 'Impact' }).click()
    const dialog = page.locator('dialog.modal, [role=dialog]').first()
    await expect(dialog).toContainText('Grade 7 - B'); await expect(dialog).toContainText('Nila Cover'); await expect(dialog.getByText('Needs cover')).toHaveCount(2)
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await main(page).getByRole('button', { name: 'Approve' }).click()
    await page.getByLabel('Remark (optional)').fill('Enjoy')
    await page.getByRole('button', { name: 'Approve', exact: true }).last().click()
    await expect(main(page)).toContainText('Leave approved.')
    expect(calls.filter(c => c.path.endsWith('/decision')).map(c => c.body)).toEqual([{ decision: 'Approved', remark: 'Enjoy', version: 1 }])
    await expect(main(page)).toContainText('Nothing waiting')
    await main(page).getByRole('tab', { name: 'Calendar' }).click()
    await expect(main(page).getByRole('cell', { name: 'Approved' })).toBeVisible(); await expect(main(page).getByRole('cell', { name: 'Enjoy' })).toBeVisible()
    await main(page).getByRole('tab', { name: 'Balances' }).click()
    await main(page).getByLabel('Choose staff member').selectOption(T1)
    await expect(main(page)).toContainText('10 of 12 days left')
  })

  test('a teacher reads balances, submits a request with a type, and withdraws a pending one', async ({ page }) => {
    const calls = await mock(page, teacher)
    await page.goto('/suite/leave-requests')
    await expect(page.getByRole('heading', { name: 'My leave' })).toBeVisible()
    await expect(main(page).getByRole('cell', { name: 'Pending' })).toBeVisible()
    await main(page).getByRole('tab', { name: 'Balance' }).click()
    await expect(main(page)).toContainText('12 of 12 days left · 2 pending'); await expect(main(page)).toContainText('Not tracked')
    expect(await axe(page)).toEqual([])
    await page.getByRole('button', { name: 'Request leave' }).click()
    await page.getByLabel('Half day').selectOption('First half')
    await page.getByLabel('From', { exact: true }).fill('2026-11-02')
    await page.getByLabel('Reason').fill('Doctor')
    await expect(page.locator('dialog.modal, [role=dialog]').first()).toContainText('0.5 day(s)')
    await page.getByRole('button', { name: 'Submit request' }).click()
    await expect(main(page)).toContainText('Leave request submitted.')
    expect(calls.find(c => c.path === '/suite/records/leave-requests')!.body).toEqual({ teacherId: T1, typeId: CL, fromDate: '2026-11-02', toDate: '2026-11-02', halfDay: 'First half', reason: 'Doctor', status: 'Pending' })
    await main(page).getByRole('tab', { name: 'Requests' }).click()
    page.once('dialog', d => d.accept())
    await main(page).getByRole('button', { name: 'Withdraw' }).click()
    await expect(main(page)).toContainText('Request withdrawn.')
    expect(calls.filter(c => c.path.endsWith('/cancel')).length).toBe(1)
    await expect(main(page).getByRole('button', { name: 'Approve' })).toHaveCount(0)
  })

  test('at 390px the queue fits without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mock(page)
    await page.goto('/suite/leave-requests')
    await expect(main(page)).toContainText('Maya Teacher')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
  })
})
