import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

// Exams & report cards in a real browser with the API mocked: leadership schedules and publishes, a teacher enters
// component marks with the keyboard and submits, a student sees the timetable and published results, a parent sees
// one child, and the phone layout. No service or database is used.
const dist = resolve(process.cwd(), 'dist')
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }
const school = '11111111-1111-4111-8111-111111111111'
const principal = { id: '22222222-2222-4222-8222-222222222222', username: 'principal', email: 'p@example.test', firstName: 'Asha', lastName: 'Rao', schoolId: school, roles: ['Principal'], dataScope: 'school', permissions: ['exams.view', 'exams.manage', 'marks.view', 'marks.manage', 'reports.view', 'classes.view'] }
const teacher = { ...principal, id: '33333333-3333-4333-8333-333333333333', username: 'ravi', firstName: 'Ravi', lastName: 'Kumar', roles: ['Teacher'], dataScope: 'teacher', permissions: ['exams.view', 'marks.view', 'marks.manage', 'classes.view'] }
const student = { ...principal, id: '44444444-4444-4444-8444-444444444444', username: 'aarav', firstName: 'Aarav', lastName: 'Sharma', roles: ['Student'], dataScope: 'student', permissions: ['exams.view', 'marks.view', 'reports.view'] }
const parent = { ...student, id: '55555555-5555-4555-8555-555555555555', username: 'neha', firstName: 'Neha', roles: ['Parent'], dataScope: 'parent' }
const E1 = 'e0000000-0000-4000-8000-000000000001', E2 = 'e0000000-0000-4000-8000-000000000002'
const scheme = { type: 'Components', max: 100, passMarks: 40, gradeOnly: false, components: [{ name: 'Theory', max: 70, pass: 28 }, { name: 'Practical', max: 30, pass: null }], grades: [{ label: 'A', minPercent: 90 }, { label: 'B', minPercent: 75 }, { label: 'C', minPercent: 60 }, { label: 'D', minPercent: 40 }, { label: 'E', minPercent: 0 }] }
const exam = (id: string, over: Record<string, unknown>) => ({ id, version: 2, name: 'Half-yearly examination', term: 'Term 1', yearId: 'y1', yearName: '2026-27', classId: 'c1', className: 'Grade 6 - A', subjectId: 's1', subjectName: 'Science', date: '2026-10-20', startsAt: '09:00', endsAt: '11:00', room: 'Hall B', instructions: 'Bring a calculator.', schemeId: 'as1', schemeName: 'Theory 70 + Practical 30', schemeType: 'Components', maxMarks: '100', passMarks: '40', status: 'MarksEntry', resultsVisible: false, ...over })
type Call = { method: string, path: string, body: Record<string, unknown> | null }

async function mock(page: Page, user = principal) {
  const calls: Call[] = []; let status = 'MarksEntry'; const marks: Record<string, Record<string, unknown>> = {}
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(([stored]) => { localStorage.setItem('accessToken', 'test-access-token'); localStorage.setItem('refreshToken', 'test-refresh-token'); localStorage.setItem('user', stored); localStorage.setItem('eduos.skipSchoolHome', '1') }, [JSON.stringify(user)])
  const json = (route: Route, body: unknown, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) })
  const mark = (id: string) => { const m = marks[id]; if (!m) return null; const c = m.components as Record<string, number>; const score = m.status === 'Present' ? (c.Theory ?? 0) + (c.Practical ?? 0) : m.status === 'Absent' ? 0 : null
    return { id: 'm' + id, version: 1, status: m.status, score, grade: m.status === 'Present' ? (score! >= 75 ? 'B' : 'E') : m.status === 'Absent' ? 'AB' : 'EX', pass: m.status === 'Exempt' || (score ?? 0) >= 40, components: [{ name: 'Theory', max: 70, score: c.Theory ?? null }, { name: 'Practical', max: 30, score: c.Practical ?? null }], remarks: m.remarks ?? '', enteredAt: '', changes: 0 } }
  const live = () => exam(E1, { status, resultsVisible: status === 'Published' || status === 'Closed' })
  const overviewRow = (e: Record<string, unknown>) => ({ ...e, assigned: 2, entered: Object.keys(marks).length, missing: 2 - Object.keys(marks).length, absent: Object.values(marks).filter(m => m.status === 'Absent').length, exempt: 0, average: null, passed: 0, failed: 0, distribution: {}, scheme })
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.startsWith('/api/') ? url.pathname.replace('/api/v1', '') : '', method = request.method()
    if (path && method !== 'GET') calls.push({ method, path, body: request.postData() ? request.postDataJSON() : null })
    if (path === '/control/me') return json(route, { data: user })
    if (path === '/suite/options') return json(route, { data: { students: [{ id: 'st1', label: 'Aarav Sharma' }, { id: 'st2', label: 'Diya Sharma' }], classes: [{ id: 'c1', label: 'Grade 6 - A' }], subjects: [{ id: 's1', label: 'Science' }], 'academic-years': [{ id: 'y1', label: '2026-27' }], 'assessment-schemes': [{ id: 'as1', label: 'Theory 70 + Practical 30' }] } })
    if (path === '/suite/exams/timetable') return json(route, { data: { items: [live(), exam(E2, { name: 'Unit test', subjectName: 'Mathematics', date: '2026-10-22', status: 'Scheduled', startsAt: '', endsAt: '', room: '', schemeId: '', schemeName: '', schemeType: 'Marks' })].filter(e => user.dataScope === 'school' || user.dataScope === 'teacher' || e.status !== 'Draft'), today: '2026-10-05' } })
    if (path === '/suite/exams/overview') return json(route, { data: { items: [overviewRow(live()), overviewRow(exam(E2, { name: 'Unit test', subjectName: 'Mathematics', date: '2026-10-22', status: 'Scheduled' }))], totals: { exams: 2, Published: status === 'Published' ? 1 : 0, pendingApproval: status === 'Submitted' ? 1 : 0, entryIncomplete: 1, entered: Object.keys(marks).length, expected: 4 }, attention: [] } })
    if (path === '/suite/exams/' + E1 + '/marksheet' && method === 'GET') return json(route, { data: { exam: live(), scheme, students: [{ studentId: 'st1', name: 'Aarav Sharma', code: 'S1', mark: mark('st1') }, { studentId: 'st2', name: 'Diya Sharma', code: 'S2', mark: mark('st2') }], entered: Object.keys(marks).length, canEdit: user.dataScope === 'school' ? ['Draft', 'Scheduled', 'MarksEntry', 'Submitted', 'Approved'].includes(status) : ['Draft', 'Scheduled', 'MarksEntry'].includes(status), canSubmit: user.dataScope === 'teacher' && ['Draft', 'Scheduled', 'MarksEntry'].includes(status) && Object.keys(marks).length > 0, canReview: user.dataScope === 'school' } })
    if (path === '/suite/exams/' + E1 + '/marksheet' && method === 'POST') { const body = request.postDataJSON() as { entries: { studentId: string, status: string, components: Record<string, number>, remarks: string }[], submit: boolean }; for (const e of body.entries) marks[e.studentId] = e; if (body.submit) status = 'Submitted'; return json(route, { data: { saved: body.entries.length, errors: [], status } }) }
    if (path === '/suite/exams/' + E1 + '/transition') { status = String((request.postDataJSON() as { to: string }).to); return json(route, { data: { id: E1, status, version: 3 } }) }
    if (path === '/suite/records/exams' && method === 'POST') return json(route, { data: { id: E2 } }, 201)
    if (path.startsWith('/suite/report-cards/')) return json(route, { data: { school: { name: 'Green Valley School', principal: 'Asha Rao' }, student: { id: 'st1', name: 'Aarav Sharma', admissionNumber: 'S1', class: 'Grade 6 - A' }, year: '2026-27', term: '', results: status === 'Published' ? [{ examId: E1, exam: 'Half-yearly examination', term: 'Term 1', date: '2026-10-20', subject: 'Science', status: 'Present', components: [{ name: 'Theory', max: 70, score: 56 }, { name: 'Practical', max: 30, score: 25 }], score: 81, maximum: 100, percent: 81, grade: 'B', pass: true, remarks: 'Good lab work', schemeType: 'Components' }] : [], obtained: status === 'Published' ? 81 : 0, maximum: status === 'Published' ? 100 : 0, percent: status === 'Published' ? 81 : 0, grade: status === 'Published' ? 'B' : 'Not available', passed: status === 'Published' ? 1 : 0, failed: 0, attendance: { present: 40, absent: 2, late: 1, excused: 0, markedDays: 43, percent: 95.3, from: '2026-06-01', to: '2027-03-31' }, signatures: { classTeacher: 'Ravi Kumar', principal: 'Asha Rao' }, generatedAt: '', note: 'Only published exams with entered marks are included. This report is not a board-issued certificate.' } })
    if (path === '/suite/reports/attendance') return json(route, { data: [] })
    if (path === '/suite/allocations') return json(route, { data: [{ studentId: 'st1', classId: 'c1' }] })
    if (path.startsWith('/suite/records/')) return json(route, { data: { data: [], totalCount: 0 } })
    if (path === '/suite/school') return json(route, { data: { name: 'Green Valley School' } })
    if (path) return json(route, { data: [] })
    if (!existsSync(dist)) return route.continue()
    const file = join(dist, url.pathname), served = extname(url.pathname) && existsSync(file) ? file : join(dist, 'index.html')
    return route.fulfill({ status: 200, contentType: types[extname(served)] ?? 'application/octet-stream', body: readFileSync(served) })
  })
  return { calls, publish: () => { status = 'Published' } }
}
const main = (page: Page) => page.locator('#main')
const axe = async (page: Page, scope: string) => (await new AxeBuilder({ page }).include(scope).analyze()).violations.flatMap(v => v.nodes.map(n => v.id + ' ' + n.target.join(' ')))

test.describe('Exams & report cards', () => {
  test('leadership sees the exams, creates one with a scheme, and moves it through the stages', async ({ page }) => {
    const { calls } = await mock(page)
    await page.goto('/suite/exams')
    await expect(page.getByRole('heading', { name: 'Exams & report cards' })).toBeVisible()
    await expect(main(page)).toContainText('Half-yearly examination')
    await expect(main(page).getByRole('row', { name: /Half-yearly/ })).toContainText('Marks entry')
    await page.getByRole('button', { name: 'New exam' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Exam name').fill('Unit test')
    await dialog.getByLabel(/^Class/).selectOption('c1')
    await dialog.getByLabel(/^Subject/).selectOption('s1')
    await dialog.getByLabel('Assessment scheme').selectOption('as1')
    await expect(dialog.getByLabel('Maximum marks')).toBeDisabled()          // the scheme decides the maximum and pass marks
    await dialog.getByLabel('Exam date').fill('2026-10-22')
    await dialog.getByLabel('Starts at').fill('09:00')
    await dialog.getByLabel('Ends at').fill('10:30')
    await dialog.getByRole('button', { name: 'Save exam' }).click()
    await expect(main(page).getByText('Exam created as a draft. Schedule it when the timetable is final.')).toBeVisible()
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/suite/records/exams', body: { name: 'Unit test', classId: 'c1', subjectId: 's1', schemeId: 'as1', date: '2026-10-22', startsAt: '09:00', endsAt: '10:30', status: 'Draft' } })
    // The stage buttons follow the lifecycle: approve what was submitted, then publish.
    await main(page).getByRole('row', { name: /Half-yearly/ }).getByRole('button', { name: 'Approve marks' }).click()
    await expect(main(page).getByRole('row', { name: /Half-yearly/ })).toContainText('Approved')
    expect(calls.at(-1)).toMatchObject({ method: 'POST', path: '/suite/exams/' + E1 + '/transition', body: { to: 'Approved', version: 2 } })
    await main(page).getByRole('row', { name: /Half-yearly/ }).getByRole('button', { name: 'Publish results' }).click()
    await expect(main(page).getByText('Results published. Students and families can see them now.')).toBeVisible()
    // Unpublishing asks for a reason first.
    await main(page).getByRole('row', { name: /Half-yearly/ }).getByRole('button', { name: 'Unpublish' }).click()
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Unpublish' })).toBeDisabled()
    await page.getByRole('dialog').getByLabel('Reason').fill('Practical marks of two students were swapped.')
    await page.getByRole('dialog').getByRole('button', { name: 'Unpublish' }).click()
    expect(calls.at(-1)).toMatchObject({ body: { to: 'Approved', reason: 'Practical marks of two students were swapped.' } })
    expect(await axe(page, '#main')).toEqual([])
  })

  test('a teacher enters component marks with the keyboard, marks a student absent, saves and submits', async ({ page }) => {
    const { calls } = await mock(page, teacher)
    await page.goto('/suite/marks')
    await expect(page.getByRole('heading', { name: 'Exams & marks' })).toBeVisible()
    await main(page).getByRole('row', { name: /Half-yearly/ }).getByRole('button', { name: 'Enter marks' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Theory 70 + Practical 30')
    await expect(dialog.getByRole('button', { name: 'Save marks' })).toBeDisabled()
    await dialog.getByLabel('Theory for Aarav Sharma').fill('56')
    await dialog.getByLabel('Theory for Aarav Sharma').press('Enter')                   // Enter moves down the column
    await expect(dialog.getByLabel('Theory for Diya Sharma')).toBeFocused()
    await dialog.getByLabel('Practical for Aarav Sharma').fill('25')
    await expect(dialog.getByRole('row', { name: /Aarav Sharma/ })).toContainText('81 / 100 · B')
    await dialog.getByLabel('Practical for Aarav Sharma').fill('31')
    await expect(dialog.getByRole('row', { name: /Aarav Sharma/ })).toContainText('Practical must be between 0 and 30')
    await expect(dialog.getByRole('button', { name: 'Save marks' })).toBeDisabled()
    await dialog.getByLabel('Practical for Aarav Sharma').fill('25')
    await dialog.getByLabel('Attendance for Diya Sharma').selectOption('Absent')
    await expect(dialog.getByLabel('Theory for Diya Sharma')).toHaveCount(0)                // absent: no marks are asked for
    await dialog.getByRole('button', { name: 'Save marks' }).click()
    await expect(main(page).getByText('2 marks saved.')).toBeVisible()
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/suite/exams/' + E1 + '/marksheet', body: { submit: false, entries: [{ studentId: 'st1', status: 'Present', components: { Theory: 56, Practical: 25 } }, { studentId: 'st2', status: 'Absent', components: {} }] } })
    await expect(dialog.getByRole('row', { name: /Diya Sharma/ })).toContainText('AB')
    await dialog.getByRole('button', { name: 'Save and submit for approval' }).click()
    await expect(main(page).getByText('Marks submitted for approval.')).toBeVisible()
    expect(calls.at(-1)).toMatchObject({ body: { submit: true } })
    await expect(main(page).getByRole('row', { name: /Half-yearly/ })).toContainText('Awaiting approval')
    await expect(main(page).getByRole('row', { name: /Half-yearly/ }).getByRole('button', { name: 'View marks' })).toBeVisible()   // no longer editable
    expect(await axe(page, '#main')).toEqual([])
  })

  test('a student sees the timetable without drafts and the results only once published', async ({ page }) => {
    const { publish } = await mock(page, student)
    await page.goto('/suite/exams')
    await expect(page.getByRole('heading', { name: 'Exams & results' })).toBeVisible()
    await expect(main(page)).toContainText('Half-yearly examination · Science')
    await expect(main(page)).toContainText('09:00–11:00 · Hall B')
    await expect(main(page)).not.toContainText('Marks entry')                                 // stages are the school's business
    await main(page).getByRole('link', { name: 'Results' }).click()
    await expect(main(page)).toContainText('No published results yet')
    await expect(main(page).getByRole('button', { name: 'Report card' })).toBeDisabled()
    publish()
    await page.reload(); await main(page).getByRole('link', { name: 'Results' }).click()
    await expect(main(page).getByRole('row', { name: /Half-yearly/ })).toContainText('81 / 100')
    await expect(main(page).getByRole('row', { name: /Half-yearly/ })).toContainText('Theory 56/70 · Practical 25/30')
    await expect(main(page).locator('.stat-card').first()).toContainText('81%')
    await expect(main(page)).toContainText('95.3%')                                            // attendance for the year
    expect(await axe(page, '#main')).toEqual([])
  })

  test('a parent sees one child at a time and nothing of any other', async ({ page }) => {
    await mock(page, parent)
    await page.goto('/suite/marks')
    await expect(page.getByLabel('Choose child')).toHaveValue('st1')
    await expect(main(page)).toContainText('Aarav Sharma')
    await expect(main(page).getByRole('button', { name: /Enter marks|Approve|Publish/ })).toHaveCount(0)
  })

  test('at 390px the timetable and the marksheet fit the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mock(page, teacher)
    await page.goto('/suite/exams')
    await expect(main(page)).toContainText('Half-yearly examination')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
    await main(page).getByRole('link', { name: 'Marks entry' }).click()
    await main(page).getByRole('button', { name: 'Enter marks' }).first().click()
    await expect(page.getByRole('dialog').getByLabel('Theory for Aarav Sharma')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
  })
})
