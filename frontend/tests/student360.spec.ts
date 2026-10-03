import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

// Student 360 in a real browser with the API mocked: the office opens a student from the directory and reads every
// tab; a teacher sees no fees or contact details; a student lands on their own profile; a parent picks a child; the
// phone layout has no sideways scrolling. No service or database is used.
const dist = resolve(process.cwd(), 'dist')
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }
const school = '11111111-1111-4111-8111-111111111111'
const admin = { id: '22222222-2222-4222-8222-222222222222', username: 'admin', email: 'a@example.test', firstName: 'Asha', lastName: 'Rao', schoolId: school, roles: ['Administrator'], dataScope: 'school', permissions: ['students.view', 'reports.view', 'exams.view', 'homework.view', 'fees.view', 'certificates.view', 'circulars.view', 'overview.view'] }
const teacher = { ...admin, id: '33333333-3333-4333-8333-333333333333', username: 'ravi', firstName: 'Ravi', lastName: 'Kumar', roles: ['Teacher'], dataScope: 'teacher', permissions: ['reports.view', 'exams.view', 'homework.view', 'classes.view', 'attendance.view'] }
const student = { ...admin, id: '44444444-4444-4444-8444-444444444444', username: 'aarav', firstName: 'Aarav', lastName: 'Sharma', roles: ['Student'], dataScope: 'student', permissions: ['reports.view', 'exams.view', 'homework.view', 'fees.view'] }
const parent = { ...student, id: '55555555-5555-4555-8555-555555555555', username: 'neha', firstName: 'Neha', roles: ['Parent'], dataScope: 'parent' }
const S1 = 'aaaaaaaa-0000-4000-8000-000000000001', S2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const view = (role: string, id: string) => {
  const office = role === 'Administrator' || role === 'Principal', family = role === 'Parent' || role === 'Student', see = { contact: office || family, fees: office || family, guardians: true, history: true }
  return { student: { id, name: id === S1 ? 'Aarav Sharma' : 'Diya Sharma', firstName: 'Aarav', lastName: 'Sharma', admissionNumber: id === S1 ? 'S1' : 'S2', className: 'Grade 6 - A', year: '2026-27', status: 'Active', admissionDate: '2024-06-01T00:00:00Z', email: see.contact ? 'aarav@example.test' : '', phone: see.contact ? '9000000001' : '', dateOfBirth: see.contact ? '2014-03-12T00:00:00Z' : null, guardians: [{ name: 'Neha Sharma', relationship: 'parent', email: see.contact ? 'neha@example.test' : '' }] },
    visibility: see, academics: { year: '2026-27', yearStatus: 'Current', classId: 'c1', className: 'Grade 6 - A', section: 'A', classTeacher: 'Ravi Kumar', allocated: true, subjects: [{ subject: 'Mathematics', teacher: 'Ravi Kumar' }, { subject: 'Science', teacher: 'Maya Teacher' }] },
    attendance: { month: '2026-10', thisMonth: { present: 3, late: 1, absent: 1, excused: 0, markedDays: 5, percent: 80 }, year: { present: 40, late: 2, absent: 3, excused: 1, markedDays: 46, percent: 91 }, from: '2026-04-01', to: '2026-10-05', recent: [{ day: '2026-10-05', status: 'Absent', reason: 'Sick', remark: '' }] },
    homework: { assigned: 4, counts: { 'due-today': 1, upcoming: 1, missing: 1, late: 0, submitted: 0, reviewed: 1, excused: 0, closed: 0 }, completion: 25, due: [{ id: 'h1', title: 'Fractions worksheet', subject: 'Mathematics', dueDate: '2026-10-07', dueTime: '15:30', group: 'upcoming' }, { id: 'h2', title: 'Reading log', subject: 'English', dueDate: '2026-10-01', dueTime: '', group: 'missing' }], feedback: [{ title: 'Plant cell diagram', subject: 'Science', grade: 'A', feedback: 'Neat labelling.', reviewedAt: '2026-10-02T10:00:00Z' }] },
    exams: { upcoming: [{ id: 'e1', name: 'Half-yearly examination', subjectName: 'Science', date: '2026-10-20', startsAt: '09:00', endsAt: '11:00', room: 'Hall B', status: 'Scheduled' }], published: 1, obtained: 81, maximum: 100, percent: 81, grade: 'B', passed: 1, failed: 0, latest: [{ exam: 'Unit test', term: 'Term 1', subject: 'Mathematics', status: 'Present', score: 81, maximum: 100, grade: 'B', pass: true, components: [] }] },
    fees: see.fees ? { available: true, charges: 2, applicable: 12000, paid: 7000, outstanding: 5000, overdue: 1, currency: 'INR', recentPayments: [{ id: 'p1', receipt: 'RCPT-0001', amount: 7000, method: 'UPI', paidOn: '2026-09-15', description: 'Term fee · 1', currency: 'INR' }] } : { available: false, reason: 'Fee details are shown to the school office and the family.' },
    documents: [{ id: 'd1', type: 'Bonafide certificate', number: 'DOC-0001', issuedOn: '2026-08-01', files: 0 }], notices: [{ id: 'n1', title: 'Parent-teacher meeting', audience: 'All', createdAt: '2026-10-01T06:00:00Z', dueDate: '' }],
    timeline: { items: [{ at: '2026-10-05T03:30:00Z', kind: 'attendance', title: 'Marked Absent', detail: '2026-10-05 · Sick', source: 'attendance', entityId: '' }, { at: '2026-10-02T10:00:00Z', kind: 'homework', title: 'Reviewed: Plant cell diagram', detail: 'A · Neat labelling.', source: 'homework', entityId: 'h3' }], total: 3, more: true, page: 1, pageSize: 20 }, generatedAt: '2026-10-05T09:00:00Z' }
}
async function mock(page: Page, user = admin) {
  const calls: string[] = []
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(([stored]) => { localStorage.setItem('accessToken', 'test-access-token'); localStorage.setItem('refreshToken', 'test-refresh-token'); localStorage.setItem('user', stored); localStorage.setItem('eduos.skipSchoolHome', '1') }, [JSON.stringify(user)])
  const json = (route: Route, body: unknown, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) })
  const students = user.dataScope === 'school' || user.dataScope === 'teacher' || user.dataScope === 'parent' ? [{ id: S1, label: 'Aarav Sharma' }, { id: S2, label: 'Diya Sharma' }] : [{ id: S1, label: 'Aarav Sharma' }]
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.startsWith('/api/') ? url.pathname.replace('/api/v1', '') : '', method = request.method()
    if (path) calls.push(method + ' ' + path + url.search)
    if (path === '/control/me') return json(route, { data: user })
    if (path === '/suite/options') return json(route, { data: { students, classes: [{ id: 'c1', label: 'Grade 6 - A' }], subjects: [] } })
    if (path === '/suite/students/' + S1 + '/360' || path === '/suite/students/' + S2 + '/360') return json(route, { data: view(user.roles[0], path.split('/')[3]) })
    if (path.endsWith('/360/timeline')) return json(route, { data: { items: [{ at: '2026-09-15T08:00:00Z', kind: 'payment', title: 'Payment received: INR 7,000', detail: 'Term fee · 1 · UPI · receipt RCPT-0001', source: 'fees', entityId: '' }], total: 3, more: false, page: 2, pageSize: 20 } })
    if (path === '/suite/reports/attendance/days') return json(route, { data: { month: '2026-10', days: [{ day: '2026-10-05', status: 'Absent', reason: 'Sick', remark: '' }], present: 3, late: 1, absent: 1, excused: 0, markedDays: 5, percent: 80 } })
    if (path === '/operations/directory/students') return json(route, { data: { data: [{ id: S1, firstName: 'Aarav', lastName: 'Sharma', email: 'aarav@example.test', phoneNumber: '', currentClass: 'Grade 6 - A', rollNumber: 'S1', status: 'Active' }], totalCount: 1 } })
    if (path === '/suite/reports/attendance') return json(route, { data: [{ studentId: S1, name: 'Aarav Sharma', class: 'Grade 6 - A', present: 3, late: 1, absent: 1, excused: 0, markedDays: 5 }] })
    if (path === '/suite/allocations') return json(route, { data: [{ studentId: S1, classId: 'c1' }] })
    if (path.startsWith('/suite/records/')) return json(route, { data: { data: [], totalCount: 0 } })
    if (path === '/suite/school') return json(route, { data: { name: 'Green Valley School' } })
    if (path) return json(route, { data: [] })
    if (!existsSync(dist)) return route.continue()
    const file = join(dist, url.pathname), served = extname(url.pathname) && existsSync(file) ? file : join(dist, 'index.html')
    return route.fulfill({ status: 200, contentType: types[extname(served)] ?? 'application/octet-stream', body: readFileSync(served) })
  })
  return calls
}
const main = (page: Page) => page.locator('#main')
const axe = async (page: Page) => (await new AxeBuilder({ page }).include('#main').analyze()).violations.flatMap(v => v.nodes.map(n => v.id + ' ' + n.target.join(' ')))
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)

test.describe('Student 360', () => {
  test('the office opens a student from the directory and reads every tab from one request', async ({ page }) => {
    const calls = await mock(page)
    await page.goto('/students')
    await page.getByRole('link', { name: 'Student 360 for Aarav Sharma' }).click()
    await expect(page.getByRole('heading', { name: 'Aarav Sharma', level: 1 })).toBeVisible()
    await expect(main(page)).toContainText('Admission S1 · Grade 6 - A · 2026-27')
    await expect(main(page)).toContainText('Guardian: Neha Sharma')
    await expect(main(page)).toContainText('aarav@example.test')
    await expect(main(page).getByRole('button', { name: /Attendance this month/ })).toContainText('80%')
    await expect(main(page).getByRole('button', { name: /Homework completion/ })).toContainText('25%')
    await expect(main(page).getByRole('button', { name: /Outstanding fees/ })).toContainText('INR 5,000')
    expect(calls.filter(c => c.includes('/360')).length).toBe(1)                            // one aggregated request for the overview
    const nav = page.getByRole('navigation', { name: 'Student sections' })
    await nav.getByRole('link', { name: 'Academics' }).click(); await expect(main(page)).toContainText('Ravi Kumar')
    await nav.getByRole('link', { name: 'Attendance' }).click(); await expect(main(page)).toContainText('42 of 46 days attended')
    await nav.getByRole('link', { name: 'Homework' }).click(); await expect(main(page)).toContainText('Neat labelling.')
    await nav.getByRole('link', { name: 'Exams & results' }).click(); await expect(main(page)).toContainText('81 / 100 · B'); await expect(main(page)).toContainText('Hall B')
    await nav.getByRole('link', { name: 'Fees' }).click(); await expect(main(page)).toContainText('RCPT-0001')
    await nav.getByRole('link', { name: 'Documents' }).click(); await expect(main(page)).toContainText('Bonafide certificate')
    await nav.getByRole('link', { name: 'Timeline' }).click(); await expect(main(page)).toContainText('Marked Absent')
    await main(page).getByRole('button', { name: 'Load earlier events' }).click(); await expect(main(page)).toContainText('Payment received: INR 7,000')
    expect(calls.filter(c => c.includes('/360')).length).toBe(2)                            // tabs reuse the picture; only the timeline page was fetched
    expect(await axe(page)).toEqual([])
  })

  test('a teacher sees the academic picture but no fees or contact details', async ({ page }) => {
    await mock(page, teacher)
    await page.goto('/student360/' + S1)
    await expect(page.getByRole('heading', { name: 'Aarav Sharma', level: 1 })).toBeVisible()
    await expect(main(page)).not.toContainText('aarav@example.test')
    await expect(main(page)).toContainText('Fee details are shown to the school office and the family.')
    await expect(page.getByRole('navigation', { name: 'Student sections' }).getByRole('link', { name: 'Fees' })).toHaveCount(0)
  })

  test('a student lands on their own profile and a parent chooses a child', async ({ browser }) => {
    const me = await browser.newPage(); await mock(me, student)
    await me.goto('/student360')
    await expect(me).toHaveURL(/\/student360\/aaaaaaaa-0000-4000-8000-000000000001$/)
    await expect(me.locator('#main')).toContainText('MY SCHOOL PROFILE')
    await expect(me.locator('#main').getByRole('link', { name: 'Another student' })).toHaveCount(0)
    await me.close()
    const mum = await browser.newPage(); await mock(mum, parent)
    await mum.goto('/student360')
    await expect(mum.getByRole('heading', { name: 'Choose a child' })).toBeVisible()
    await mum.locator('#main').getByRole('link', { name: 'Open' }).nth(1).click()
    await expect(mum.getByRole('heading', { name: 'Diya Sharma', level: 1 })).toBeVisible()
    await mum.close()
  })

  test('at 390px the header, cards and tabs fit without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mock(page)
    await page.goto('/student360/' + S1)
    await expect(page.getByRole('heading', { name: 'Aarav Sharma', level: 1 })).toBeVisible()
    expect(await noOverflow(page)).toBe(true)
    await page.getByRole('navigation', { name: 'Student sections' }).getByRole('link', { name: 'Timeline' }).click()
    await expect(main(page)).toContainText('Marked Absent')
    expect(await noOverflow(page)).toBe(true)
  })
})
