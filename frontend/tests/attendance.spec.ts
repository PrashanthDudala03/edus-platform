import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

// The daily register workflow in a real browser with the API mocked: marking, reasons, submit, correction with a
// reason, the leadership registers panel, the family day view, and the phone layout. No service or database is used.
const dist = resolve(process.cwd(), 'dist')
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }
const school = '11111111-1111-4111-8111-111111111111'
const teacher = { id: '22222222-2222-4222-8222-222222222222', username: 'ravi.teacher', email: 'ravi@example.test', firstName: 'Ravi', lastName: 'Kumar', schoolId: school, roles: ['Teacher'], dataScope: 'teacher', permissions: ['attendance.view', 'attendance.mark', 'reports.view', 'classes.view'] }
const principal = { ...teacher, id: '33333333-3333-4333-8333-333333333333', username: 'meera', firstName: 'Meera', lastName: 'Iyer', roles: ['Principal'], dataScope: 'school', permissions: ['overview.view', 'attendance.view', 'attendance.mark', 'reports.view', 'staff-attendance.view', 'leave-requests.view', 'admissions.view', 'exams.view', 'circulars.view', 'fees.view'] }
const parent = { ...teacher, id: '44444444-4444-4444-8444-444444444444', username: 'neha', firstName: 'Neha', lastName: 'Sharma', roles: ['Parent'], dataScope: 'parent', permissions: ['reports.view', 'homework.view', 'submissions.view', 'certificates.view', 'circulars.view', 'calendar.view', 'exams.view', 'timetable.view', 'fees.view'] }
const students = [{ id: 'a1', code: 'S1', name: 'Aarav Sharma', class: 'Grade 6 - A', status: null }, { id: 'b2', code: 'S2', name: 'Diya Sharma', class: 'Grade 6 - A', status: null }, { id: 'c3', code: 'S3', name: 'Rohan Das', class: 'Grade 3 - B', status: 'Present' }]
type Call = { path: string, body: Record<string, unknown> }

async function mock(page: Page, user = teacher, options: { submitted?: string[] } = {}) {
  const calls: Call[] = [], submitted = new Set(options.submitted ?? []), marks = new Map<string, { status: string, reason?: string, remark?: string }>()
  for (const s of students) if (s.status) marks.set(s.id, { status: s.status })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(([stored]) => { localStorage.setItem('accessToken', 'test-access-token'); localStorage.setItem('refreshToken', 'test-refresh-token'); localStorage.setItem('user', stored); localStorage.setItem('eduos.skipSchoolHome', '1') }, [JSON.stringify(user)])
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  const registers = () => { const classes = [...new Set(students.map(s => s.class))].sort().map(cls => { const ids = students.filter(s => s.class === cls).map(s => s.id), got = ids.filter(id => marks.has(id)).map(id => marks.get(id)!.status)
    return { className: cls, expected: ids.length, marked: got.length, present: got.filter(x => x === 'Present').length, absent: got.filter(x => x === 'Absent').length, late: got.filter(x => x === 'Late').length, excused: got.filter(x => x === 'Excused').length, state: submitted.has(cls) ? 'Submitted' : got.length === 0 ? 'Not started' : got.length < ids.length ? 'In progress' : 'Marked', teacher: cls === 'Grade 6 - A' ? 'Ravi Kumar' : null, submittedAt: null, correctedAt: null, submittedBy: null } })
    const marked = classes.reduce((n, c) => n + c.marked, 0), present = classes.reduce((n, c) => n + c.present, 0), late = classes.reduce((n, c) => n + c.late, 0)
    return { day: '2026-10-05', totals: { expected: students.length, marked, present, absent: classes.reduce((n, c) => n + c.absent, 0), late, excused: 0, completed: classes.filter(c => c.state === 'Submitted').length, pending: classes.filter(c => c.state !== 'Submitted').length, percent: marked ? Math.round((present + late) / marked * 100) : 0 }, classes, reasons: ['Sick', 'Approved leave', 'Transport delay', 'Medical', 'School activity', 'Family', 'Other'] } }
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.startsWith('/api/') ? url.pathname.replace('/api/v1', '') : '', method = request.method()
    if (path === '/control/me') return json(route, { data: user })
    if (path === '/suite/student-attendance/registers') return json(route, { data: registers() })
    if (path === '/suite/student-attendance/history') return json(route, { data: [{ student: 'Aarav Sharma', kind: 'correction', oldStatus: 'Present', newStatus: 'Absent', reason: 'Sick', remark: null, changedAt: '2026-10-05T04:10:00Z', changedBy: 'Ravi Kumar' }] })
    if (path === '/suite/student-attendance' && method === 'GET') return json(route, { data: students.map(s => ({ ...s, ...(marks.get(s.id) ?? { status: null }) })) })
    if (path === '/suite/student-attendance' && method === 'POST') {
      const body = request.postDataJSON() as { entries: { studentId: string, status: string, reason?: string, remark?: string }[], submit?: boolean, reason?: string }
      calls.push({ path, body })
      const correction = body.entries.some(e => submitted.has(students.find(s => s.id === e.studentId)!.class))
      if (correction && !body.reason) return json(route, { message: 'Give a reason for the change.' }, 400)
      for (const e of body.entries) marks.set(e.studentId, { status: e.status, reason: e.reason, remark: e.remark })
      let done: string[] = []
      if (body.submit) done = [...new Set(body.entries.map(e => students.find(s => s.id === e.studentId)!.class))].filter(cls => !submitted.has(cls) && students.filter(s => s.class === cls).every(s => marks.has(s.id)))
      for (const cls of done) submitted.add(cls)
      return json(route, { message: done.length ? 'Register submitted for ' + done.join(', ') + '.' : correction ? 'Correction recorded.' : 'Attendance saved.', data: { changed: body.entries.length, submitted: done } })
    }
    if (path === '/suite/reports/attendance/days') return json(route, { data: { month: '2026-10', days: [{ day: '2026-10-05', status: 'Absent', reason: 'Sick', remark: null }, { day: '2026-10-04', status: 'Present', reason: null, remark: null }, { day: '2026-10-03', status: 'Late', reason: 'Transport delay', remark: 'Bus' }], present: 1, late: 1, absent: 1, excused: 0, markedDays: 3, percent: 67 } })
    if (path === '/suite/reports/attendance') return json(route, { data: [{ studentId: 'a1', admissionNumber: 'S1', name: 'Aarav Sharma', class: 'Grade 6 - A', present: 1, absent: 1, late: 1, excused: 0, markedDays: 3 }] })
    if (path === '/suite/options') return json(route, { data: { students: [{ id: 'a1', label: 'Aarav Sharma' }], classes: [{ id: 'c1', label: 'Grade 6 - A' }], subjects: [] } })
    if (path === '/suite/allocations') return json(route, { data: [{ studentId: 'a1', classId: 'c1' }] })
    if (path === '/suite/report-cards/a1') return json(route, { data: { results: [], obtained: 0, maximum: 0, percent: 0, grade: '' } })
    if (path === '/operations/overview') return json(route, { data: { stats: { students: 3, teachers: 2, parents: 2, classes: 2, present: 1, marked: 1 }, classes: [] } })
    if (path.startsWith('/suite/records/')) return json(route, { data: { data: [], totalCount: 0 } })
    if (path === '/suite/reports/marks') return json(route, { data: [] })
    if (path === '/suite/fees') return json(route, { data: [] })
    if (path === '/suite/catalog') return json(route, { data: [] })
    if (path === '/suite/school' || path.startsWith('/schools/')) return json(route, { data: { name: 'Green Valley School' } })
    if (path) return json(route, { data: [] })
    if (!existsSync(dist)) return route.continue()
    const file = join(dist, url.pathname), served = extname(url.pathname) && existsSync(file) ? file : join(dist, 'index.html')
    return route.fulfill({ status: 200, contentType: types[extname(served)] ?? 'application/octet-stream', body: readFileSync(served) })
  })
  return calls
}
const main = (page: Page) => page.locator('#main')
const mark = (page: Page, name: string, status: string) => page.getByRole('radio', { name: `${name}: ${status}` })

test.describe('Daily register', () => {
  test('a teacher marks a class in a few taps, gives a reason, and submits the register', async ({ page }) => {
    const calls = await mock(page)
    await page.goto('/suite/register')
    await expect(page.getByRole('heading', { name: 'Student register' })).toBeVisible()
    await expect(main(page).getByRole('status')).toContainText('1 present')
    await expect(main(page).getByRole('status')).toContainText('2 not marked')
    await page.getByLabel('Class').selectOption('Grade 6 - A')
    await mark(page, 'Aarav Sharma', 'Absent').click()
    await expect(mark(page, 'Aarav Sharma', 'Absent')).toHaveAttribute('aria-checked', 'true')
    await page.getByLabel('Reason for Aarav Sharma').selectOption('Sick')
    await expect(page.getByLabel('Reason for Diya Sharma')).toHaveCount(0)   // not marked yet, so no reason cell
    await page.getByRole('button', { name: 'Mark the rest present' }).click()
    await expect(main(page).getByRole('status')).toContainText('0 not marked')
    await expect(main(page).getByRole('status')).toContainText('2 unsaved')
    await page.getByRole('button', { name: 'Submit register' }).click()
    await expect(page.getByRole('dialog')).toContainText('register for Grade 6 - A marked as submitted')
    await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click()
    await expect(main(page).getByText('Register submitted for Grade 6 - A.')).toBeVisible()
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toEqual({ day: expect.any(String), submit: true, entries: [{ studentId: 'a1', status: 'Absent', reason: 'Sick', remark: '' }, { studentId: 'b2', status: 'Present', reason: '', remark: '' }] })
    await expect(main(page).getByText('Submitted', { exact: true })).toBeVisible()
    expect((await new AxeBuilder({ page }).include('#main').analyze()).violations).toEqual([])
  })

  test('a change to a submitted register is a correction and needs a reason; the change is listed for leadership', async ({ page }) => {
    const calls = await mock(page, principal, { submitted: ['Grade 3 - B'] })
    await page.goto('/suite/register')
    const panel = page.getByRole('region', { name: /attendance registers/i })
    await expect(panel).toContainText('Grade 3 - B')
    await expect(panel).toContainText('1 submitted · 1 pending')
    await panel.getByRole('button', { name: 'Open' }).first().click()
    await expect(page.getByLabel('Class')).toHaveValue('Grade 3 - B')
    await mark(page, 'Rohan Das', 'Late').click()
    await page.getByRole('button', { name: 'Record correction' }).click()
    const dialog = page.getByRole('dialog', { name: 'Record a correction' })
    await expect(dialog.getByRole('button', { name: 'Record correction' })).toBeDisabled()
    await dialog.getByLabel('Reason').selectOption('Transport delay')
    await dialog.getByRole('button', { name: 'Record correction' }).click()
    await expect(main(page).getByText('Correction recorded.')).toBeVisible()
    expect(calls[0].body).toMatchObject({ reason: 'Transport delay', entries: [{ studentId: 'c3', status: 'Late', reason: '', remark: '' }] })
    await page.getByRole('button', { name: 'Changes', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('Present → Absent')
    await expect(page.getByRole('dialog')).toContainText('Ravi Kumar')
  })

  test('the principal dashboard shows which registers are done', async ({ page }) => {
    await mock(page, principal, { submitted: ['Grade 3 - B'] })
    await page.goto('/principal')
    const panel = page.getByRole('region', { name: /attendance registers/i })
    await expect(panel).toContainText('Grade 6 - A')
    await expect(panel).toContainText('Not started')
    await expect(panel).toContainText('Ravi Kumar')
    await expect(panel.getByText('Submitted', { exact: true })).toBeVisible()
  })

  test('a parent sees each marked day with the reason the school recorded', async ({ page }) => {
    await mock(page, parent)
    await page.goto('/parent')
    const panel = page.getByRole('region', { name: /attendance days/i }).or(page.locator('.panel', { hasText: 'Attendance days' }))
    await expect(panel.first()).toContainText('Sick')
    await expect(panel.first()).toContainText('Transport delay: Bus')
    await expect(panel.first()).toContainText('67%')
  })

  test('at 390px the register still marks with one tap each and nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mock(page)
    await page.goto('/suite/register')
    await expect(mark(page, 'Diya Sharma', 'Present')).toBeVisible()
    const boxes = await Promise.all(['Present', 'Late', 'Absent', 'Excused'].map(s => mark(page, 'Diya Sharma', s).boundingBox()))
    expect(new Set(boxes.map(b => Math.round(b!.y)))).toHaveProperty('size', 1)   // the four marks sit on one line
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
  })
})
