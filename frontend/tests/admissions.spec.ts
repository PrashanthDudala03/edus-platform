import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

// Admissions 2.0 and Student Onboarding 2.0 in a real browser with the API mocked: the office reviews and onboards an
// application step by step and activates it once; a principal approves with the duplicate warning acknowledged; a
// parent cannot open the workspace; the layout holds from 1440px to 360px. No service, database or account is touched.
const dist = resolve(process.cwd(), 'dist')
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }
const school = '11111111-1111-4111-8111-111111111111', A1 = 'aaaaaaaa-0000-4000-8000-0000000000a1', C1 = 'cccccccc-0000-4000-8000-000000000001', F1 = 'ffffffff-0000-4000-8000-000000000001', P1 = 'pppppppp-0000-4000-8000-000000000001'
const admin = { id: '22222222-2222-4222-8222-222222222222', username: 'admin', email: 'a@example.test', firstName: 'Asha', lastName: 'Rao', schoolId: school, roles: ['Administrator'], dataScope: 'school', permissions: ['admissions.view', 'admissions.manage', 'admissions.approve', 'onboarding.manage', 'fees.manage', 'fee-structures.view', 'classes.view', 'overview.view', 'users.create', 'roles.assign'] }
const principal = { ...admin, id: '33333333-3333-4333-8333-333333333333', username: 'meera', roles: ['Principal'], permissions: ['admissions.view', 'admissions.approve', 'overview.view'] }
const parent = { ...admin, id: '44444444-4444-4444-8444-444444444444', username: 'neha', roles: ['Parent'], dataScope: 'parent', permissions: ['reports.view', 'fees.view'] }
type Call = { method: string, path: string, body: Record<string, unknown> | null }

async function mock(page: Page, user = admin, initial = 'Under Review') {
  const calls: Call[] = []; let status = initial; const done: Record<string, boolean> = { details: false, guardian: false, documents: false, academics: true, fees: false, accounts: false }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(([stored]) => { localStorage.setItem('accessToken', 't'); localStorage.setItem('refreshToken', 'r'); localStorage.setItem('user', stored); localStorage.setItem('eduos.skipSchoolHome', '1') }, [JSON.stringify(user)])
  const json = (route: Route, body: unknown, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) })
  const steps = () => [['details', 'Applicant'], ['guardian', 'Guardian'], ['documents', 'Documents'], ['academics', 'Academics'], ['fees', 'Fees'], ['accounts', 'Accounts']].map(([key, label]) => ({ key, label, done: done[key], required: key !== 'accounts', detail: done[key] ? '' : key === 'documents' ? 'Birth certificate not verified' : 'to do' }))
  const blockers = () => steps().filter(s => s.required && !s.done).map(s => s.label + ': ' + s.detail)
  const detail = () => ({ id: A1, version: 3, applicationNumber: 'APP-2026-000007', admissionNumber: '', status, name: 'Riya Learner', classId: C1, className: 'Grade 6 - A', yearName: '2026-27', guardianName: 'Kiran Guardian', submittedAt: '2026-10-01T09:00:00Z', createdAt: '2026-10-01T09:00:00Z', studentId: status === 'Active' ? 'st1' : '',
    application: { firstName: 'Riya', lastName: 'Learner', dateOfBirth: '2014-05-01', gender: 'Female', email: 'riya@example.test', guardianName: 'Kiran Guardian', guardianEmail: 'kiran@example.test', guardianPhone: '9000000003', address: '1 School Lane', classId: C1, reviewNotes: 'Interview went well' },
    answers: {}, form: [], history: [{ from: '', to: 'Submitted', by: 'u', at: '2026-10-01T09:00:00Z', reason: '' }], duplicates: [{ source: 'application', id: 'x', label: 'Riya Learner', number: 'APP-2026-000003', status: 'Withdrawn', reasons: ['Same name and date of birth'] }], started: status === 'Onboarding' || status === 'Ready',
    onboarding: { steps: steps(), blockers: blockers(), done: steps().filter(s => s.done).length, total: 6, documents: [{ key: 'birth-certificate', label: 'Birth certificate', required: true, status: done.documents ? 'Verified' : 'Uploaded', note: '', checkedAt: '' }], attachments: [], guardian: { mode: 'new', parentId: '', relationship: done.guardian ? 'Mother' : '', confirmed: done.guardian }, academics: { classId: C1, className: 'Grade 6 - A' }, fees: { mode: done.fees ? 'assign' : '', reason: '', structures: done.fees ? [{ id: F1, name: 'Tuition', installment: 'Term 1', dueDate: '2026-11-01', amount: 15000 }] : [], total: done.fees ? 15000 : 0 }, accounts: {}, detailsConfirmed: done.details } })
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.startsWith('/api/') ? url.pathname.replace('/api/v1', '') : '', method = req.method()
    if (path && method !== 'GET') calls.push({ method, path, body: req.postData() ? req.postDataJSON() : null })
    if (path === '/control/me') return json(route, { data: user })
    if (path === '/suite/options') return json(route, { data: { classes: [{ id: C1, label: 'Grade 6 - A (2026-27)' }], 'academic-years': [] } })
    if (path === '/suite/admissions/pipeline') return json(route, { data: { counts: { Draft: 0, Submitted: 2, 'Under Review': status === 'Under Review' ? 1 : 0, Approved: status === 'Approved' ? 1 : 0, Waitlisted: 0, Rejected: 1, Withdrawn: 1, Onboarding: status === 'Onboarding' ? 1 : 0, Ready: status === 'Ready' ? 1 : 0, Active: status === 'Active' ? 4 : 3 }, total: 1, page: 1, pageSize: 25, canApprove: user.permissions.includes('admissions.approve'), canManage: user.permissions.includes('admissions.manage'), canOnboard: user.permissions.includes('onboarding.manage'),
      items: [{ id: A1, version: 3, applicationNumber: 'APP-2026-000007', admissionNumber: '', status, name: 'Riya Learner', classId: C1, className: 'Grade 6 - A', yearName: '2026-27', guardianName: 'Kiran Guardian', submittedAt: '2026-10-01T09:00:00Z', createdAt: '', studentId: '', documents: { required: 2, verified: 0, files: 1 }, duplicates: 1 }] } })
    if (path === '/suite/admissions/' + A1) return json(route, { data: detail() })
    if (path === '/suite/admissions/' + A1 + '/transition') { const body = req.postDataJSON(); if (body.to === 'Approved' && !body.acknowledgeDuplicates) return json(route, { message: '1 possible duplicate(s) found.' }, 409); status = body.to; return json(route, { data: { id: A1, status } }) }
    if (path === '/suite/admissions/' + A1 + '/onboarding/start') { if (status === 'Approved') status = 'Onboarding'; return json(route, { data: { id: A1, status } }) }
    if (path === '/suite/admissions/' + A1 + '/onboarding') { const body = req.postDataJSON(); done[body.section] = true; status = blockers().length ? 'Onboarding' : 'Ready'; return json(route, { data: { id: A1, status } }) }
    if (path === '/suite/admissions/' + A1 + '/activate') { if (status !== 'Ready') return json(route, { message: 'Complete onboarding before activating the student.' }, 409); status = 'Active'; return json(route, { data: { studentId: 'st1', status } }) }
    if (path === '/suite/admissions/' + A1 + '/candidates') return json(route, { data: { guardians: [{ id: P1, name: 'Kiran Guardian', email: 'kiran@example.test', phone: '9000000003', children: 1 }], users: [] } })
    if (path === '/suite/records/fee-structures') return json(route, { data: { data: [{ id: F1, name: 'Tuition', installment: 'Term 1', classId: C1, amount: 15000, dueDate: '2026-11-01' }], totalCount: 1 } })
    if (path === '/suite/documents') return json(route, { data: [{ id: 'd1', name: 'birth.pdf', type: 'application/pdf', length: 2048 }] })
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

test.describe('Admissions 2.0 and Student Onboarding 2.0', () => {
  test('a principal approves an application only after acknowledging the possible duplicate, and cannot onboard', async ({ page }) => {
    const calls = await mock(page, principal)
    await page.goto('/suite/admissions')
    await expect(page.getByRole('heading', { name: 'Admissions', exact: true })).toBeVisible()
    await expect(main(page)).toContainText('Possible duplicate'); expect(await axe(page)).toEqual([])
    await expect(page.getByRole('button', { name: 'New application' })).toHaveCount(0)
    await main(page).getByRole('button', { name: 'Open' }).click()
    await expect(main(page)).toContainText('Same name and date of birth'); await expect(main(page)).toContainText('Nothing is merged automatically')
    await main(page).getByRole('button', { name: 'Approve' }).click()
    const dialog = page.locator('dialog.modal, [role=dialog]').first()
    await expect(dialog.getByRole('button', { name: 'Approve' })).toBeDisabled()
    await dialog.getByLabel('I reviewed the possible duplicates and this is a different child.').check()
    await dialog.getByRole('button', { name: 'Approve' }).click()
    await expect(main(page)).toContainText('Approve: done.')
    expect(calls.filter(c => c.path.endsWith('/transition')).map(c => c.body)).toEqual([{ to: 'Approved', reason: '', version: 3, acknowledgeDuplicates: true }])
    await expect(main(page).getByRole('button', { name: 'Start onboarding' })).toHaveCount(0)
  })

  test('the office starts onboarding, works through the checklist and activates once', async ({ page }) => {
    const calls = await mock(page, admin, 'Approved')
    await page.goto('/suite/admissions?id=' + A1)
    await main(page).getByRole('button', { name: 'Start onboarding' }).click()
    await expect(main(page)).toContainText('Onboarding started.'); await expect(main(page)).toContainText('blocking activation')
    await expect(main(page).getByRole('button', { name: 'Applicant', exact: true })).toHaveAttribute('aria-current', 'step')
    await main(page).getByLabel('The student’s details are correct').check(); await main(page).getByRole('button', { name: 'Save' }).click()
    await expect(main(page)).toContainText('Applicant details saved.')
    await main(page).getByRole('button', { name: 'Guardian', exact: true }).click()
    await main(page).getByRole('radio', { name: /Kiran Guardian.*1 child/ }).check(); await main(page).getByLabel('Relationship', { exact: true }).selectOption('Mother')
    await main(page).getByLabel('The guardian and relationship are confirmed').check(); await main(page).getByRole('button', { name: 'Save' }).click()
    await expect(main(page)).toContainText('Guardian saved.')
    expect(calls.find(c => c.body?.section === 'guardian')!.body).toEqual({ section: 'guardian', mode: 'existing', parentId: P1, relationship: 'Mother', confirmed: true, version: 3 })
    await main(page).getByRole('button', { name: 'Documents', exact: true }).click()
    await main(page).getByRole('button', { name: 'Verify' }).click(); await expect(main(page)).toContainText('Birth certificate: verified.')
    await main(page).getByRole('button', { name: 'Fees', exact: true }).click()
    await main(page).getByRole('checkbox', { name: /Tuition · Term 1/ }).check(); await main(page).getByRole('button', { name: 'Save' }).click()
    await expect(main(page)).toContainText('Fees saved.')
    expect(calls.find(c => c.body?.section === 'fees')!.body).toEqual({ section: 'fees', mode: 'assign', structureIds: [F1], version: 3 })
    expect(await axe(page)).toEqual([])
    await main(page).getByRole('button', { name: 'Review & activate' }).click()
    await expect(main(page)).toContainText('Everything required is in place')
    page.once('dialog', d => d.accept())
    await main(page).getByRole('button', { name: 'Activate student' }).click()
    await expect(main(page)).toContainText('Student activated.')
    await expect(main(page).getByRole('link', { name: /Open Student 360/ })).toHaveAttribute('href', '/student360/st1')
    expect(calls.filter(c => c.path.endsWith('/activate')).length).toBe(1)
  })

  test('a parent cannot open the admissions workspace', async ({ page }) => {
    await mock(page, parent)
    await page.goto('/suite/admissions')
    await expect(page.locator('.forbidden-page')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Admissions & onboarding' })).toHaveCount(0)
  })

  for (const width of [1440, 1024, 768, 390, 360]) test(`at ${width}px the pipeline and the onboarding checklist fit without sideways scrolling`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await mock(page, admin, 'Onboarding')
    await page.goto('/suite/admissions'); await expect(main(page)).toContainText('Riya Learner')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
    await page.goto('/suite/admissions?id=' + A1); await expect(main(page)).toContainText('Onboarding')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
  })
})
