import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

// Timetable 2.0 in a real browser with the API mocked: the office reads a class week, places a lesson by period and
// covers an absent teacher in two clicks; a teacher sees the period they cover; a student sees the substitute's
// name and nothing about leave. No service or database is involved.
const dist = resolve(process.cwd(), 'dist')
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }
const school = '11111111-1111-4111-8111-111111111111'
const admin = { id: '22222222-2222-4222-8222-222222222222', username: 'admin', email: 'a@example.test', firstName: 'Asha', lastName: 'Rao', schoolId: school, roles: ['Administrator'], dataScope: 'school', permissions: ['timetable.view', 'timetable.manage', 'substitutions.view', 'substitutions.manage', 'period-slots.view', 'period-slots.manage', 'overview.view', 'leave-requests.view', 'leave-requests.approve'] }
const teacher = { ...admin, id: '33333333-3333-4333-8333-333333333333', username: 'nila', firstName: 'Nila', lastName: 'Cover', roles: ['Teacher'], dataScope: 'teacher', permissions: ['timetable.view', 'substitutions.view', 'leave-requests.view', 'leave-requests.manage'] }
const student = { ...admin, id: '44444444-4444-4444-8444-444444444444', username: 'aarav', firstName: 'Aarav', lastName: 'Sharma', roles: ['Student'], dataScope: 'student', permissions: ['timetable.view', 'period-slots.view'] }
const C1 = 'cccccccc-0000-4000-8000-000000000001', T1 = 'tttttttt-0000-4000-8000-000000000001', T2 = 'tttttttt-0000-4000-8000-000000000002', L1 = 'llllllll-0000-4000-8000-000000000001', S1 = 'ssssssss-0000-4000-8000-000000000001'
type Call = { method: string, path: string, body: Record<string, unknown> | null }
const slots = [{ id: S1, name: 'Period 1', order: 1, startsAt: '09:00', endsAt: '09:45', type: 'Teaching' }, { id: 's2', name: 'Period 2', order: 2, startsAt: '09:45', endsAt: '10:30', type: 'Teaching' }, { id: 'b', name: 'Break', order: 3, startsAt: '10:30', endsAt: '10:45', type: 'Break' }]
const lesson = (date: string, covered: boolean, office: boolean) => ({ id: L1, day: 'Monday', startsAt: '09:00', endsAt: '09:45', slotId: S1, room: 'Lab 1', yearId: 'y', classId: C1, className: 'Grade 6 - A', subjectId: 'sub', subjectName: 'Science', teacherId: T1, teacherName: 'Maya Teacher', version: 1, date, substituted: covered,
  effectiveTeacherId: covered ? T2 : T1, effectiveTeacherName: covered ? 'Nila Cover' : 'Maya Teacher', ...(office ? { away: true, status: covered ? 'covered' : 'uncovered', ...(covered ? { substitution: { id: 'sub1', teacherId: T2, teacherName: 'Nila Cover', note: '', version: 1 } } : {}) } : {}) })

async function mock(page: Page, user = admin) {
  const calls: Call[] = []; let covered = false
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(([stored]) => { localStorage.setItem('accessToken', 'test-access-token'); localStorage.setItem('refreshToken', 'test-refresh-token'); localStorage.setItem('user', stored); localStorage.setItem('eduos.skipSchoolHome', '1') }, [JSON.stringify(user)])
  const json = (route: Route, body: unknown, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) })
  const office = user.dataScope === 'school'
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.startsWith('/api/') ? url.pathname.replace('/api/v1', '') : '', method = request.method()
    if (path && method !== 'GET') calls.push({ method, path, body: request.postData() ? request.postDataJSON() : null })
    if (path === '/control/me') return json(route, { data: user })
    if (path === '/suite/catalog') return json(route, { data: [{ kind: 'timetable', title: 'Timetable', group: 'Learning', canWrite: office, fields: [{ key: 'classId', label: 'Class', type: 'reference', required: true, source: 'classes' }, { key: 'subjectId', label: 'Subject', type: 'reference', required: true, source: 'subjects' }, { key: 'teacherId', label: 'Teacher', type: 'reference', required: true, source: 'teachers' }, { key: 'day', label: 'Day', type: 'select', required: true, options: ['Monday', 'Tuesday'] }, { key: 'slotId', label: 'Period', type: 'reference', required: false, source: 'period-slots' }, { key: 'startsAt', label: 'Starts', type: 'time', required: false }, { key: 'endsAt', label: 'Ends', type: 'time', required: false }, { key: 'room', label: 'Room', type: 'text', required: false }, { key: 'yearId', label: 'Academic year', type: 'reference', required: false, source: 'academic-years' }] }] })
    if (path === '/suite/options') return json(route, { data: { classes: [{ id: C1, label: 'Grade 6 - A (2026-27)' }], subjects: [{ id: 'sub', label: 'Science' }], teachers: [{ id: T1, label: 'Maya Teacher' }, { id: T2, label: 'Nila Cover' }], 'period-slots': slots.map(s => ({ id: s.id, label: s.name })), 'academic-years': [], students: [{ id: 'st1', label: 'Aarav Sharma' }] } })
    if (path === '/suite/timetable/week') return json(route, { data: { from: '2026-10-05', to: '2026-10-11', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day, i) => ({ day, date: '2026-10-' + String(5 + i).padStart(2, '0') })), slots, periods: [lesson('2026-10-05', covered, office)], office, filter: { classId: url.searchParams.get('classId') ?? '', teacherId: '', room: '' }, classes: [{ id: C1, name: 'Grade 6 - A' }] } })
    if (path === '/suite/timetable/today') return json(route, { data: user.dataScope === 'teacher' ? { date: '2026-10-05', day: 'Monday', away: false, slots, periods: covered ? [{ ...lesson('2026-10-05', true, true), covering: true, originalTeacherName: 'Maya Teacher' }] : [] } : { date: '2026-10-05', day: 'Monday', classId: C1, className: 'Grade 6 - A', slots, periods: [lesson('2026-10-05', covered, false)] } })
    if (path === '/suite/timetable/operations') return json(route, { data: { date: '2026-10-05', day: 'Monday', away: [{ teacherId: T1, teacherName: 'Maya Teacher', leaveId: 'lv', type: 'Casual leave', halfDay: 'No', fromDate: '2026-10-05', toDate: '2026-10-05', source: 'leave' }], periods: [lesson('2026-10-05', covered, true)], summary: { away: 1, affected: 1, covered: covered ? 1 : 0, uncovered: covered ? 0 : 1 } } })
    if (path === '/suite/timetable/candidates') return json(route, { data: { period: lesson('2026-10-05', false, true), candidates: [{ teacherId: T2, name: 'Nila Cover', free: true, reason: '', teachesSubject: true, teachesClass: false, load: 2 }, { teacherId: 't3', name: 'Busy Person', free: false, reason: 'This teacher is teaching at that time.', teachesSubject: false, teachesClass: false, load: 5 }] } })
    if (path === '/suite/records/substitutions' && method === 'POST') { covered = true; return json(route, { data: { id: 'sub1' } }, 201) }
    if (path === '/suite/records/timetable' && method === 'POST') return json(route, { data: { id: 'new' } }, 201)
    if (path === '/suite/timetable/copy' && method === 'POST') return json(route, { data: { copied: 1 } }, 201)
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

test.describe('Timetable 2.0', () => {
  test('the office covers an uncovered lesson from the day view in two clicks, and the grid shows the substitute', async ({ page }) => {
    const calls = await mock(page)
    await page.goto('/suite/timetable')
    await expect(page.getByRole('heading', { name: 'Timetable' })).toBeVisible()
    await expect(main(page)).toContainText('Need cover')
    await expect(main(page).getByRole('cell', { name: 'Needs cover' })).toBeVisible()
    expect(await axe(page)).toEqual([])
    await main(page).getByRole('button', { name: 'Assign' }).click()
    const dialog = page.locator('dialog.modal, [role=dialog]').first()
    await expect(dialog).toContainText('Busy Person'); await expect(dialog.getByRole('radio', { name: /Busy Person/ })).toBeDisabled()
    await dialog.getByRole('radio', { name: /Nila Cover/ }).check()
    await dialog.getByRole('button', { name: 'Assign substitute' }).click()
    await expect(main(page)).toContainText('Substitute assigned.')
    expect(calls.filter(c => c.path === '/suite/records/substitutions').map(c => c.body)).toEqual([{ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), timetableId: L1, teacherId: T2, note: '' }])
    await expect(main(page).getByRole('cell', { name: 'Nila Cover' })).toBeVisible()
    // The class grid: lessons sit in the school's periods; the covered lesson names the substitute; a lesson can be added by period.
    await main(page).getByRole('tab', { name: 'Class' }).click()
    await main(page).getByLabel('Choose class').selectOption(C1)
    await expect(main(page).locator('th[scope=row]', { hasText: 'Period 1' })).toBeVisible(); await expect(main(page).locator('th[scope=row]', { hasText: 'Break' })).toBeVisible()
    await expect(main(page)).toContainText('Nila Cover · Lab 1 (substitute)')
    await main(page).getByRole('button', { name: 'Add period' }).click()
    await page.locator('select[name=classId]').selectOption(C1); await page.locator('select[name=subjectId]').selectOption('sub'); await page.locator('select[name=teacherId]').selectOption(T1)
    await page.locator('select[name=day]').selectOption('Tuesday'); await page.locator('select[name=slotId]').selectOption('s2')
    await page.getByRole('button', { name: 'Save period' }).click()
    await expect(main(page)).toContainText('Period added.')
    expect(calls.find(c => c.path === '/suite/records/timetable')!.body).toMatchObject({ classId: C1, day: 'Tuesday', slotId: 's2' })
    await main(page).getByRole('button', { name: 'Copy a day' }).click()
    await page.getByRole('button', { name: 'Copy periods' }).click()
    await expect(main(page)).toContainText('1 period(s) copied to Tuesday.')
  })

  test('a teacher sees the period they cover, and a student sees the substitute with nothing about leave', async ({ page, browser }) => {
    await mock(page, teacher)
    await page.goto('/suite/timetable')
    await expect(page.getByRole('heading', { name: 'My timetable' })).toBeVisible()
    await expect(main(page)).toContainText('No periods today')
    const context = await browser.newContext(); const other = await context.newPage(); await mock(other, student)
    await other.goto('/suite/timetable')
    await expect(other.getByRole('heading', { name: 'My timetable' })).toBeVisible()
    await expect(other.locator('#main')).toContainText('Science · Grade 6 - A · Maya Teacher')
    await expect(other.locator('#main')).not.toContainText('Needs cover'); await expect(other.locator('#main')).not.toContainText('Casual leave')
    await other.locator('#main').getByRole('tab', { name: 'Week' }).click()
    await expect(other.locator('#main').locator('th[scope=row]', { hasText: 'Period 1' })).toBeVisible()
    await expect(other.locator('#main').getByRole('button', { name: /Edit/ })).toHaveCount(0)
    expect((await new AxeBuilder({ page: other }).include('#main').analyze()).violations).toEqual([])
    await context.close()
  })

  test('at 390px the day view fits without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mock(page, student)
    await page.goto('/suite/timetable')
    await expect(main(page)).toContainText('Science')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
  })
})
