import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

// The header identity (name, role and avatar) and My account, for every role, in a real browser with the API mocked.
// Also the phone layout of a shared table: labelled cards, related actions on one line, nothing scrolling sideways.
const dist = resolve(process.cwd(), 'dist')
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }
const school = '11111111-1111-4111-8111-111111111111'
const person = (firstName: string, lastName: string, role: string, dataScope: string, permissions: string[] = []) => ({ id: '33333333-3333-4333-8333-333333333333', username: firstName.toLowerCase() + '@example.test', email: firstName.toLowerCase() + '@example.test', firstName, lastName, schoolId: dataScope === 'platform' ? '00000000-0000-0000-0000-00000000e005' : school, roles: [role], dataScope, permissions })
const people = {
  teacher: person('Ravi', 'Kumar', 'Teacher', 'teacher', ['classes.view', 'homework.view', 'subjects.view', 'subjects.manage']),
  parent: person('Neha', 'Sharma', 'Parent', 'parent', ['homework.view']),
  student: person('Aarav', 'Sharma', 'Student', 'student', ['homework.view']),
  principal: person('Kavita', 'Menon', 'Principal', 'school', ['overview.view']),
  administrator: person('Asha', 'Mehta', 'Administrator', 'school', ['overview.view', 'school.settings.manage', 'school.settings.view']),
  superadmin: person('Platform', 'Owner', 'SuperAdmin', 'platform', ['platform.manage']),
  longName: person('Venkatanarasimharajuvaripeta', 'Subrahmanyeswara-Chandrasekhar', 'Examinations and Assessment Coordinator', 'school', ['overview.view']),
}
const homeworkModule = { kind: 'subjects', title: 'Subjects', group: 'Learning', canWrite: true, fields: [{ key: 'title', label: 'Assignment', type: 'text', required: true }, { key: 'classId', label: 'Class', type: 'reference', required: true, source: 'classes' }, { key: 'subjectId', label: 'Subject', type: 'reference', required: true, source: 'subjects' }, { key: 'dueDate', label: 'Due date', type: 'date', required: true }] }
const homework = [1, 2].map(n => ({ id: `7c1d0000-0000-4000-8000-00000000000${n}`, version: 1, title: 'Fractions worksheet ' + n, classId: 'c1', subjectId: 's1', dueDate: '2026-10-0' + n }))

async function mock(page: Page, user: typeof people.teacher) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(([stored]) => { localStorage.setItem('accessToken', 'test-access-token'); localStorage.setItem('refreshToken', 'test-refresh-token'); localStorage.setItem('user', stored) }, [JSON.stringify(user)])
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body }) })
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), path = url.pathname.startsWith('/api/') ? url.pathname.replace('/api/v1', '') : ''
    if (path === '/control/me') return json(route, user)
    if (path === '/auth/logout') return json(route, {})
    if (path === '/suite/school' || path.startsWith('/schools/')) return json(route, { name: 'Green Valley School' })
    if (path === '/suite/options') return json(route, { students: [{ id: 'st1', label: 'Aarav Sharma' }, { id: 'st2', label: 'Diya Sharma' }], classes: [{ id: 'c1', label: 'Grade 6 - A' }, { id: 'c2', label: 'Grade 3 - B' }], subjects: [{ id: 's1', label: 'Mathematics' }] })
    if (path === '/suite/allocations') return json(route, [{ studentId: 'st1', classId: 'c1' }, { studentId: 'st2', classId: 'c2' }])
    if (path === '/suite/records/classes') return json(route, { data: [{ id: 'c1', name: 'Grade 6', section: 'A' }], totalCount: 1 })
    if (path === '/suite/records/teaching-assignments') return json(route, { data: [{ id: 'a1', classId: 'c1', subjectId: 's1' }], totalCount: 1 })
    if (path === '/suite/catalog') return json(route, [homeworkModule])
    if (path === '/suite/records/subjects') return json(route, { data: homework, totalCount: 2, page: 1, pageSize: 20 })
    if (path === '/suite/home') return json(route, { home: null, canManage: false })
    if (path) return json(route, [])
    if (!existsSync(dist)) return route.continue()
    const file = join(dist, url.pathname), served = extname(url.pathname) && existsSync(file) ? file : join(dist, 'index.html')
    return route.fulfill({ status: 200, contentType: types[extname(served)] ?? 'application/octet-stream', body: readFileSync(served) })
  })
}
const identity = (page: Page) => page.getByRole('button', { name: /^My account:/ })
const profile = (page: Page) => page.getByRole('dialog', { name: 'My account' })
const main = (page: Page) => page.locator('#main')
const fits = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)

test.describe('Header identity and My account', () => {
  for (const [key, user] of Object.entries(people).filter(([key]) => key !== 'longName')) {
    test(`${key}: name, role and avatar are one control that opens the profile card, which leads to My account`, async ({ page }) => {
      await mock(page, user)
      await page.goto(key === 'superadmin' ? '/super-admin/account' : '/suite')
      const control = identity(page)
      await expect(control).toHaveAccessibleName(`My account: ${user.firstName} ${user.lastName}, ${user.roles[0]}`)
      await expect(control).toContainText(user.firstName)
      await expect(control).toContainText(user.roles[0])
      await expect(control).toHaveCSS('cursor', 'pointer')
      const box = (await control.boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(44)
      // The name, not only the avatar, opens the page.
      // A real pointer click at four places across the block: on the name, the role, between them and on the avatar.
      for (const [fx, fy] of [[0.15, 0.3], [0.15, 0.75], [0.6, 0.5], [0.93, 0.5]]) {
        const hit = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('button.identity'), [box.x + box.width * fx, box.y + box.height * fy])
        expect(hit).toBe(true)
      }
      const header = await page.locator('.topbar').boundingBox(), before = await page.evaluate(() => [...document.querySelectorAll('.topbar-right > *, #main > *')].map(el => el.getBoundingClientRect().x + ',' + el.getBoundingClientRect().y).join(';'))
      await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.3)
      // A compact card opens directly under the identity, inside the screen, and nothing on the page moves.
      const popover = profile(page)
      await expect(popover).toBeVisible()
      await expect(control).toHaveAttribute('aria-expanded', 'true')
      await expect(popover).toContainText(`${user.firstName} ${user.lastName}`)
      await expect(popover).toContainText(user.roles[0])
      await expect(popover).toContainText(key === 'superadmin' ? 'EduOS platform' : 'Green Valley School')
      await expect(popover).toContainText(user.username)
      await expect(popover).not.toContainText(user.id)
      await expect(popover.getByRole('link')).toHaveText(['View profile'])
      await expect(popover.getByRole('button')).toHaveText(['Sign out'])
      const place = (await popover.boundingBox())!
      expect(place.y).toBeGreaterThanOrEqual(header!.y + header!.height - 12)
      expect(place.x).toBeGreaterThanOrEqual(0)
      expect(place.x + place.width).toBeLessThanOrEqual(1280 + 1)
      expect(Math.abs(place.x + place.width - (box.x + box.width))).toBeLessThan(12)   // anchored to the identity's right edge
      expect(place.width).toBeLessThanOrEqual(320)
      expect(await page.evaluate(() => [...document.querySelectorAll('.topbar-right > *, #main > *')].map(el => el.getBoundingClientRect().x + ',' + el.getBoundingClientRect().y).join(';'))).toBe(before)
      // A second click closes it; so does Escape; so does a click anywhere else.
      await control.click(); await expect(popover).toHaveCount(0)
      await control.click(); await expect(popover).toBeVisible(); await page.keyboard.press('Escape'); await expect(popover).toHaveCount(0); await expect(control).toBeFocused()
      await control.click(); await expect(popover).toBeVisible(); await main(page).click({ position: { x: 5, y: 5 } }); await expect(popover).toHaveCount(0)
      await control.click(); await popover.getByRole('link', { name: 'View profile' }).click()
      await expect(page).toHaveURL(key === 'superadmin' ? /\/super-admin\/account$/ : /\/account$/)
      await expect(popover).toHaveCount(0)
      await expect(page.getByRole('heading', { name: 'My account' })).toBeVisible()
      const card = page.getByRole('region', { name: 'Account details' })
      await expect(card).toContainText(`${user.firstName} ${user.lastName}`)
      await expect(card).toContainText(user.roles[0])
      await expect(card).toContainText(user.email)
      await expect(card).toContainText(key === 'superadmin' ? 'EduOS platform' : 'Green Valley School')
      // No internal identifiers, and nothing that looks editable.
      await expect(card).not.toContainText(user.id)
      await expect(card).not.toContainText(user.schoolId)
      await expect(card.locator('input, select, textarea')).toHaveCount(0)
      await expect(card.getByRole('button')).toHaveText(['Sign out'])
      if (key === 'teacher') { await expect(card).toContainText('Grade 6 - A'); await expect(card).toContainText('Mathematics') }
      if (key === 'parent') { await expect(card).toContainText('Linked children'); await expect(card).toContainText('Diya Sharma'); await expect(card).toContainText('Grade 3 - B') }
      if (key === 'student') await expect(card.getByText('Class', { exact: true })).toBeVisible()
      expect((await new AxeBuilder({ page }).include('header').include('#main').exclude('.topbar .avatar').analyze()).violations).toEqual([])
    })
  }

  test('the identity control works from the keyboard and Sign out ends the session', async ({ page }) => {
    await mock(page, people.teacher)
    await page.goto('/suite')
    await identity(page).focus()
    await page.keyboard.press('Enter')
    await expect(profile(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(profile(page)).toHaveCount(0)
    await page.keyboard.press('Space')
    await expect(profile(page)).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(profile(page).getByRole('link', { name: 'View profile' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(profile(page).getByRole('button', { name: 'Sign out' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/login$/)
    expect(await page.evaluate(() => localStorage.getItem('accessToken'))).toBeNull()
  })

  for (const width of [360, 390, 412, 768, 1024, 1440]) {
    test(`a very long name and role never push the header outside a ${width}px screen`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await mock(page, people.longName)
      await page.goto('/account')
      await expect(page.getByRole('heading', { name: 'My account' })).toBeVisible()
      await fits(page)
      const box = (await identity(page).boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1)
      // The profile card fits the screen at every width too.
      await identity(page).click()
      const place = (await profile(page).boundingBox())!
      expect(place.x).toBeGreaterThanOrEqual(0)
      expect(place.x + place.width).toBeLessThanOrEqual(width + 1)
      await fits(page)
      await page.keyboard.press('Escape')
      // The full name is still readable on the page itself.
      await expect(main(page)).toContainText('Venkatanarasimharajuvaripeta Subrahmanyeswara-Chandrasekhar')
    })
  }
})

test.describe('Shared record table on a phone', () => {
  for (const width of [360, 390, 412]) {
    test(`at ${width}px a row is a labelled card with its actions on one line and no sideways scrolling`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await mock(page, people.teacher)
      await page.goto('/suite/subjects')
      const row = main(page).locator('tbody tr').first()
      await expect(row).toContainText('Fractions worksheet 1')
      await fits(page)
      expect(await main(page).locator('.table-scroll').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      // Each detail carries its column name, copied from the table header.
      await expect(row.locator('td').nth(1)).toHaveAttribute('data-label', 'Class')
      await expect(row.locator('td').nth(3)).toHaveAttribute('data-label', 'Due date')
      const view = await row.getByRole('button', { name: 'View record and attachments' }).boundingBox(), edit = await row.getByRole('button', { name: 'Edit record' }).boundingBox()
      expect(Math.abs(view!.y - edit!.y)).toBeLessThan(4)       // side by side, not stacked
      expect(edit!.x).toBeGreaterThan(view!.x)
      for (const box of [view!, edit!]) { expect(box.width).toBeGreaterThanOrEqual(40); expect(box.height).toBeGreaterThanOrEqual(40) }
    })
  }

  test('on a desktop the same data is still a table', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await mock(page, people.teacher)
    await page.goto('/suite/subjects')
    await expect(main(page).getByRole('columnheader', { name: 'Due date' })).toBeVisible()
    await expect(main(page).locator('tbody tr').first()).toHaveCSS('display', 'table-row')
    await fits(page)
  })
})
