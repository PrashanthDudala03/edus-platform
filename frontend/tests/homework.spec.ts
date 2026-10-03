import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

// Homework & assignments in a real browser with the API mocked: a teacher drafts, publishes, checks off notebook work
// and reviews a written answer; a student hands in (and again); a parent sees the board for one child; the phone
// layout. No service or database is used.
const dist = resolve(process.cwd(), 'dist')
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }
const school = '11111111-1111-4111-8111-111111111111'
const teacher = { id: '22222222-2222-4222-8222-222222222222', username: 'ravi.teacher', email: 'ravi@example.test', firstName: 'Ravi', lastName: 'Kumar', schoolId: school, roles: ['Teacher'], dataScope: 'teacher', permissions: ['homework.view', 'homework.manage', 'submissions.view', 'submissions.manage', 'classes.view', 'documents.view', 'documents.upload'] }
const student = { ...teacher, id: '44444444-4444-4444-8444-444444444444', username: 'aarav', firstName: 'Aarav', lastName: 'Sharma', roles: ['Student'], dataScope: 'student', permissions: ['homework.view', 'submissions.view', 'submissions.manage', 'documents.view', 'documents.upload', 'reports.view'] }
const parent = { ...student, id: '55555555-5555-4555-8555-555555555555', username: 'neha', firstName: 'Neha', roles: ['Parent'], dataScope: 'parent', permissions: ['homework.view', 'submissions.view', 'documents.view', 'reports.view'] }
const H1 = 'a0000000-0000-4000-8000-000000000001', H2 = 'a0000000-0000-4000-8000-000000000002', S1 = 'b0000000-0000-4000-8000-000000000001', S2 = 'b0000000-0000-4000-8000-000000000002'
const assignment = (id: string, over: Record<string, unknown>) => ({ id, version: 3, title: 'Fractions worksheet', classId: 'c1', className: 'Grade 6 - A', subjectId: 's1', subjectName: 'Mathematics', teacher: 'Ravi Kumar', instructions: 'Complete page 4.', dueDate: '2026-10-07', dueTime: '15:30', maxMarks: '20', submissionMode: 'Text', status: 'Published', publishedOn: '2026-10-05', attachments: 1, ...over })
const groupOf = (outcome: string) => outcome === 'Completed' ? 'submitted' : outcome === 'Late' ? 'late' : outcome === 'Missing' ? 'missing' : 'excused'
type Call = { method: string, path: string, body: Record<string, unknown> | null }

async function mock(page: Page, user = teacher) {
  const calls: Call[] = []; let reviewed: { grade: string, feedback: string } | null = null, response = '', version = 0, submitted = false, checked = ''
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(([stored]) => { localStorage.setItem('accessToken', 'test-access-token'); localStorage.setItem('refreshToken', 'test-refresh-token'); localStorage.setItem('user', stored); localStorage.setItem('eduos.skipSchoolHome', '1') }, [JSON.stringify(user)])
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  const sub = () => submitted ? { id: S1, version, status: reviewed ? 'Reviewed' : 'Submitted', submittedAt: '2026-10-06T09:00:00Z', late: false, outcome: '', verifiedAt: '', response, grade: reviewed?.grade ?? '', feedback: reviewed?.feedback ?? '', reviewedAt: '', resubmissions: Math.max(0, version - 1), attachments: 0 } : null
  const second = () => checked ? { id: S2, version: 1, status: '', submittedAt: '', late: checked === 'Late', outcome: checked, verifiedAt: '2026-10-06T10:00:00Z', response: '', grade: '', feedback: '', reviewedAt: '', resubmissions: 0, attachments: 0 } : null
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.startsWith('/api/') ? url.pathname.replace('/api/v1', '') : '', method = request.method()
    if (path && method !== 'GET') calls.push({ method, path, body: request.postData() ? request.postDataJSON() : null })
    if (path === '/control/me') return json(route, { data: user })
    if (path === '/suite/options') return json(route, { data: { students: [{ id: 'st1', label: 'Aarav Sharma' }, { id: 'st2', label: 'Diya Sharma' }], classes: [{ id: 'c1', label: 'Grade 6 - A' }], subjects: [{ id: 's1', label: 'Mathematics' }, { id: 's2', label: 'Science' }] } })
    if (path === '/suite/homework/overview') return json(route, { data: { items: [{ ...assignment(H1, {}), assigned: 2, submitted: (submitted ? 1 : 0) + (checked === 'Completed' || checked === 'Late' ? 1 : 0), late: checked === 'Late' ? 1 : 0, reviewed: reviewed ? 1 : 0, pending: submitted && !reviewed ? 1 : 0, missing: checked === 'Missing' ? 1 : 0, overdue: false }, { ...assignment(H2, { title: 'Volcano project', status: 'Draft', subjectName: 'Science', subjectId: 's2', submissionMode: 'Done', attachments: 0 }), assigned: 2, submitted: 0, late: 0, reviewed: 0, pending: 0, missing: 0, overdue: false }], totals: {} } })
    if (path === '/suite/homework/board') return json(route, { data: { studentId: 'st1', items: [{ ...assignment(H1, {}), group: reviewed ? 'reviewed' : submitted ? 'submitted' : 'upcoming', submission: sub() }, { ...assignment(H2, { title: 'Reading log', dueDate: '2026-10-01', submissionMode: 'Done', attachments: 0 }), group: 'missing', submission: null }], counts: { upcoming: submitted ? 0 : 1, submitted: submitted && !reviewed ? 1 : 0, reviewed: reviewed ? 1 : 0, missing: 1 } } })
    if (path === '/suite/homework/' + H1 + '/submissions') return json(route, { data: { assignment: assignment(H1, {}), students: [{ studentId: 'st1', name: 'Aarav Sharma', code: 'S1', group: reviewed ? 'reviewed' : submitted ? 'submitted' : 'upcoming', submission: sub() }, { studentId: 'st2', name: 'Diya Sharma', code: 'S2', group: checked ? groupOf(checked) : 'upcoming', submission: second() }] } })
    if (path === '/suite/homework/' + H1 + '/review/st1' && method === 'PUT') { reviewed = request.postDataJSON(); version++; return json(route, { data: { id: S1 } }) }
    if (path === '/suite/homework/' + H1 + '/verify/st2' && method === 'PUT') { checked = String((request.postDataJSON() as { outcome: string }).outcome); return json(route, { data: { id: S2 } }) }
    if (path === '/suite/records/homework' && method === 'POST') return json(route, { data: { id: H2 } }, 201)
    if (path.startsWith('/suite/records/homework/') && method === 'PUT') return json(route, { data: { id: H2 } })
    if (path === '/suite/records/submissions' && method === 'POST') { submitted = true; response = String((request.postDataJSON() as { response: string }).response); version = 1; return json(route, { data: { id: S1 } }, 201) }
    if (path === '/suite/records/submissions/' + S1 && method === 'PUT') { response = String((request.postDataJSON() as { response: string }).response); version++; return json(route, { data: { id: S1 } }) }
    if (path === '/suite/documents') return json(route, { data: method === 'GET' && url.searchParams.get('recordId') === H1 ? [{ id: 'd1', name: 'worksheet.pdf', type: 'application/pdf', length: 20480, uploadedAt: '2026-10-05T06:00:00Z' }] : [] })
    if (path === '/suite/reports/attendance') return json(route, { data: [] })
    if (path === '/suite/reports/attendance/days') return json(route, { data: { days: [], present: 0, late: 0, absent: 0, excused: 0, markedDays: 0, percent: 0 } })
    if (path === '/suite/allocations') return json(route, { data: [{ studentId: 'st1', classId: 'c1' }] })
    if (path.startsWith('/suite/report-cards/')) return json(route, { data: { results: [], obtained: 0, maximum: 0, percent: 0, grade: '' } })
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

test.describe('Homework & assignments', () => {
  test('a teacher creates a zero-upload assignment, publishes it, and sees the class overview', async ({ page }) => {
    const calls = await mock(page)
    await page.goto('/suite/homework')
    await expect(page.getByRole('heading', { name: 'Homework & assignments' })).toBeVisible()
    await expect(main(page)).toContainText('Fractions worksheet')
    await expect(main(page)).toContainText('Volcano project')
    await page.getByRole('button', { name: 'New assignment' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('Submission mode')).toHaveValue('Done')          // notebook homework needs no upload
    await expect(dialog).toContainText('No upload.')
    await dialog.getByLabel('Title').fill('Volcano project')
    await dialog.getByLabel(/^Class/).selectOption('c1')
    await dialog.getByLabel('Subject').selectOption('s2')
    await dialog.getByLabel('Instructions').fill('Build a model and explain the layers.')
    await dialog.getByRole('button', { name: 'Save and publish' }).click()
    await expect(main(page).getByText('Assignment published. Students and families have been told.')).toBeVisible()
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/suite/records/homework', body: { title: 'Volcano project', classId: 'c1', subjectId: 's2', status: 'Published', submissionMode: 'Done', instructions: 'Build a model and explain the layers.' } })
    await expect(main(page).locator('.stat-card').first()).toContainText('Published')
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    expect((await new AxeBuilder({ page }).include('#main').analyze()).violations.flatMap(v => v.nodes.map(n => v.id + ' ' + n.target.join(' ')))).toEqual([])
  })

  test('a teacher checks notebook work off as completed, late, missing or excused with one click', async ({ page }) => {
    const calls = await mock(page)
    await page.goto('/suite/homework')
    await page.getByRole('row', { name: /Fractions worksheet/ }).getByRole('button', { name: 'Review' }).click()
    const dialog = page.getByRole('dialog', { name: /Review · Fractions worksheet/ })
    const diya = dialog.getByRole('row', { name: /Diya Sharma/ })
    await expect(diya).toContainText('Upcoming')
    await expect(diya.getByRole('button', { name: 'Review' })).toHaveCount(0)   // nothing to open until something is handed in
    await diya.getByRole('button', { name: 'Late' }).click()
    await expect(diya).toContainText('Completed late')
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', path: '/suite/homework/' + H1 + '/verify/st2', body: { outcome: 'Late' } })
    await diya.getByRole('button', { name: 'Excused' }).click()
    await expect(diya).toContainText('Excused')
    await diya.getByRole('button', { name: 'Excused' }).click()                   // the same check again clears it
    expect(calls.at(-1)).toMatchObject({ body: { outcome: '', version: 1 } })
    await expect(dialog.getByRole('group', { name: 'Check Diya Sharma' })).toBeVisible()
    expect((await new AxeBuilder({ page }).include('dialog.modal').analyze()).violations.flatMap(v => v.nodes.map(n => v.id + ' ' + n.target.join(' ') + ' ' + JSON.stringify(n.any[0]?.data)))).toEqual([])
  })

  test('a student hands in, hands in again, and sees the earlier work is kept', async ({ browser }) => {
    const page = await browser.newPage(), calls = await mock(page, student)
    await page.goto('/suite/homework')
    await expect(page.getByRole('heading', { name: 'Homework', exact: true })).toBeVisible()
    await expect(page.locator('.homework-panel', { hasText: 'Missing' })).toContainText('Reading log')
    await page.locator('.homework-panel', { hasText: 'Upcoming' }).getByRole('button', { name: 'Open' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Complete page 4.')
    await expect(dialog).toContainText('worksheet.pdf')
    await expect(dialog.getByRole('button', { name: 'Hand in' })).toHaveCount(0)   // a written answer is needed first
    await dialog.getByLabel('Your response').fill('Answers attached in my notebook.')
    await dialog.getByRole('button', { name: 'Hand in' }).click()
    await expect(dialog.getByText('Handed in.')).toBeVisible()
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/suite/records/submissions', body: { homeworkId: H1, studentId: 'st1', response: 'Answers attached in my notebook.', feedback: '', grade: '' } })
    await page.keyboard.press('Escape')
    await page.locator('.homework-panel', { hasText: 'Completed' }).getByRole('button', { name: 'Open' }).click()
    await page.getByRole('dialog').getByLabel('Your response').fill('Corrected answers.')
    await page.getByRole('dialog').getByRole('button', { name: 'Hand in again' }).click()
    await expect(page.getByRole('dialog').getByText('Handed in again. Your earlier work is kept.')).toBeVisible()
    expect(calls[1]).toMatchObject({ method: 'PUT', path: '/suite/records/submissions/' + S1, body: { response: 'Corrected answers.', version: 1 } })
    await page.close()
  })

  test('a student marks notebook homework as done with one tap and no upload', async ({ browser }) => {
    const page = await browser.newPage(), calls = await mock(page, student)
    await page.goto('/suite/homework')
    await page.locator('.homework-panel', { hasText: 'Missing' }).getByRole('button', { name: 'Open' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('textbox')).toHaveCount(0)
    await expect(dialog.getByText(/upload/i)).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Mark as done' }).click()
    await expect(dialog.getByText('Marked as done.')).toBeVisible()
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/suite/records/submissions', body: { homeworkId: H2, studentId: 'st1', response: '' } })
    await page.close()
  })

  test('a parent sees the board for the chosen child only and cannot hand in', async ({ page }) => {
    await mock(page, parent)
    await page.goto('/suite/homework')
    await expect(page.getByRole('heading', { name: 'Homework', exact: true })).toBeVisible()
    await expect(page.getByLabel('Choose child')).toHaveValue('st1')
    await expect(main(page)).toContainText('Reading log')
    await expect(main(page).getByText('Missing', { exact: true }).first()).toBeVisible()
    await main(page).getByRole('button', { name: 'Open' }).first().click()
    await expect(page.getByRole('dialog').getByRole('button', { name: /Hand in|Mark as done/ })).toHaveCount(0)
  })

  test('the teacher review saves marks and feedback for a written answer', async ({ page }) => {
    const calls = await mock(page)
    await page.goto('/suite/homework')
    await page.evaluate(() => fetch('/api/v1/suite/records/submissions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ homeworkId: 'a0000000-0000-4000-8000-000000000001', studentId: 'st1', response: 'Done', feedback: '', grade: '' }) }))
    await page.reload()
    await page.getByRole('row', { name: /Fractions worksheet/ }).getByRole('button', { name: 'Review' }).click()
    const dialog = page.getByRole('dialog', { name: /Review · Fractions worksheet/ })
    await dialog.getByRole('row', { name: /Aarav Sharma/ }).getByRole('button', { name: 'Review' }).click()
    await expect(dialog.locator('.review-response')).toHaveText('Done')
    await dialog.getByLabel(/Marks/).fill('17')
    await dialog.getByLabel('Feedback').fill('Good work, check question 3.')
    await dialog.getByRole('button', { name: 'Save review' }).click()
    await expect(dialog.getByRole('row', { name: /Aarav Sharma/ })).toContainText('17 / 20')
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', path: '/suite/homework/' + H1 + '/review/st1', body: { grade: '17', feedback: 'Good work, check question 3.', version: 1 } })
  })

  test('at 390px the teacher list and the student board fit the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mock(page)
    await page.goto('/suite/homework')
    await expect(main(page)).toContainText('Fractions worksheet')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
  })
})
