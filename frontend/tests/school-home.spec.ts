import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

// School Home in a real browser with the whole API mocked: no service, database or account is needed.
// When a local build exists (npm run build) the pages are served from it, so no server is needed either;
// otherwise they come from the running frontend at the configured base URL.
const dist = resolve(process.cwd(), 'dist')
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const school = '11111111-1111-4111-8111-111111111111'
const image = (n: number) => `7c1d0000-0000-4000-8000-00000000000${n}`
const teacher = { id: '22222222-2222-4222-8222-222222222222', username: 'asha.teacher', email: 'asha@example.test', firstName: 'Asha', lastName: 'Rao', schoolId: school, roles: ['Teacher'], dataScope: 'teacher', permissions: ['calendar.view', 'circulars.view', 'timetable.view'] }
const admin = { ...teacher, id: '33333333-3333-4333-8333-333333333333', username: 'meera.admin', firstName: 'Meera', roles: ['Administrator'], dataScope: 'school', permissions: ['overview.view', 'school-home.manage', 'teachers.view', 'calendar.view', 'circulars.view'] }
const published = { schoolName: 'Green Valley School', sections: [
  { key: 'hero', content: { tagline: 'Learning with purpose', bannerId: image(1), bannerPosition: 'center', logoId: image(2) } },
  { key: 'identity', content: { motto: 'Knowledge and character', vision: 'Every child, confident and curious.', mission: 'Teach well and care deeply.' } },
  { key: 'principal', content: { name: 'Dr. Kavita Menon', designation: 'Principal', message: 'Welcome to a new year of learning.', photoId: image(3), photoPosition: 'top' } },
  { key: 'results', content: { academicYear: '2025-26', passPercentage: '98.5', distinctions: '142', toppers: [{ rank: '1st', name: 'Class X topper', detail: '98.4%' }] } },
  { key: 'statistics', content: { items: [{ label: 'Students', value: '1250' }, { label: 'Teachers', value: '84' }, { label: 'Years of excellence', value: '25+' }] } },
  { key: 'faculty', content: { items: [{ name: 'Asha Rao', department: 'Science', designation: 'Head of Science', description: 'Leads the science faculty.', photoId: '', photoPosition: 'center' }] } },
  { key: 'achievements', content: { items: [{ title: 'State science fair winners', description: 'First place for the robotics team.', category: 'Academic', imageId: image(4) }] } },
  { key: 'events', content: { items: [{ title: 'Annual Day', startsOn: '2026-11-14', endsOn: '2026-11-15', description: 'Performances and prize giving.' }] } },
  { key: 'announcements', content: { items: [{ title: 'Winter uniform from Monday', message: 'Students wear the winter uniform from next week.', createdAt: '2026-10-01T05:00:00Z' }] } },
  { key: 'gallery', content: { items: [{ imageId: image(5), caption: 'Sports day' }, { imageId: image(6), caption: '' }] } },
] }
const keys = ['hero', 'identity', 'principal', 'results', 'statistics', 'faculty', 'achievements', 'events', 'announcements', 'gallery']
const draft = () => ({
  sections: keys.map(key => ({ key, visible: true })),
  hero: { tagline: 'Learning with purpose', bannerId: '', bannerPosition: 'center', logoId: '' }, identity: { motto: '', vision: '', mission: '' },
  principal: { name: '', designation: '', message: '', photoId: '', photoPosition: 'center' }, results: { academicYear: '', passPercentage: '', distinctions: '', toppers: [] },
  statistics: { items: [] }, faculty: { items: [] }, achievements: { items: [] }, events: { count: 5 }, announcements: { count: 5 }, gallery: { items: [] },
})
type User = typeof teacher
type Options = { user?: User, home?: unknown, signedIn?: boolean, homeStatus?: number }
type Saved = { draft: ReturnType<typeof draft>, version: number, action: string }

async function mock(page: Page, options: Options = {}) {
  const user = options.user ?? teacher, saved: Saved[] = [], uploads: string[] = []
  if (options.signedIn !== false) await page.addInitScript(([stored]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('accessToken', 'test-access-token'); localStorage.setItem('refreshToken', 'test-refresh-token'); localStorage.setItem('user', stored); sessionStorage.setItem('seeded', '1') } }, [JSON.stringify(user)])
  const json = (route: Route, data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status < 400 ? { data } : { message: 'Unhandled exception at db.internal:5432' }) })
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api/v1', ''), method = request.method()
    if (path === '/auth/login') return json(route, { accessToken: 'test-access-token', refreshToken: 'test-refresh-token', expiresIn: 900, user })
    if (path === '/control/me') return json(route, user)
    if (path === '/suite/home' && method === 'GET') return json(route, { home: options.home === undefined ? published : options.home, canManage: user.permissions.includes('school-home.manage') }, options.homeStatus ?? 200)
    if (path === '/suite/home' && method === 'PUT') { const body = request.postDataJSON() as Saved; saved.push(body); return json(route, { draft: body.draft, version: body.version + 1, published: body.action === 'publish', publishedAt: body.action === 'publish' ? '2026-10-02T06:00:00Z' : null, pending: body.action !== 'publish' }) }
    if (path === '/suite/home/manage') return json(route, { draft: draft(), version: 3, published: false, publishedAt: null, pending: true, teachers: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', label: 'Asha Rao' }] })
    if (path === '/suite/home/preview') return json(route, { schoolName: 'Green Valley School', sections: published.sections.slice(0, 2) })
    if (path === '/suite/home/images' && method === 'POST') { uploads.push(request.headers()['content-type'] ?? ''); return json(route, { id: image(7) }, 201) }
    if (path.startsWith('/suite/home/images/')) return route.fulfill({ status: 200, contentType: 'image/png', body: png })
    if (url.pathname.startsWith('/api/')) return json(route, path.endsWith('/school') ? { name: 'Green Valley School' } : [])
    if (!existsSync(dist)) return route.continue()
    const file = join(dist, url.pathname)
    const served = extname(url.pathname) && existsSync(file) ? file : join(dist, 'index.html')
    return route.fulfill({ status: 200, contentType: types[extname(served)] ?? 'application/octet-stream', body: readFileSync(served) })
  })
  return { saved, uploads }
}
async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email or username').fill('asha.teacher')
  await page.getByLabel('Password', { exact: true }).fill('not-a-real-password')
  await page.getByRole('button', { name: 'Sign in to workspace' }).click()
}
const main = (page: Page) => page.locator('#main')

test.describe('School Home', () => {
  test('sign-in leads to School Home, and Enter Dashboard leads to the role dashboard', async ({ page }) => {
    await mock(page, { signedIn: false })
    await signIn(page)
    await expect(page).toHaveURL(/\/home$/)
    await expect(main(page).getByRole('heading', { name: 'Green Valley School', exact: true })).toBeVisible()
    for (const text of ['Learning with purpose', 'Knowledge and character', 'Welcome to a new year of learning.', 'Dr. Kavita Menon', '98.5%', '1,250', '25+', 'Head of Science · Science', 'State science fair winners', 'Annual Day', 'Winter uniform from Monday', 'Sports day'])
      await expect(main(page).getByText(text, { exact: true })).toBeVisible()
    await expect(main(page).getByRole('img', { name: 'Green Valley School logo' })).toBeVisible()
    // Full screen: no sidebar, no workspace top bar or breadcrumb, and no manage shortcut for a role without the permission.
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0)
    await expect(page.locator('.sidebar, .topbar, .breadcrumb')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Manage School Home' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
    await main(page).getByRole('link', { name: 'Enter Dashboard' }).first().click()
    await expect(page).toHaveURL(/\/teacher$/)
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
  })

  test('a school with nothing published goes straight to the dashboard, as before', async ({ page }) => {
    await mock(page, { signedIn: false, home: null })
    await signIn(page)
    await expect(page).toHaveURL(/\/teacher$/)
  })

  test('a failing School Home request never blocks sign-in', async ({ page }) => {
    await mock(page, { signedIn: false, homeStatus: 500 })
    await signIn(page)
    await expect(page).toHaveURL(/\/teacher$/)
  })

  test('the platform administrator is not sent to School Home', async ({ page }) => {
    await mock(page, { signedIn: false, user: { ...teacher, roles: ['SuperAdmin'], dataScope: 'platform', permissions: ['platform.manage'] } })
    await signIn(page)
    await expect(page).toHaveURL(/\/super-admin$/)
  })

  test('Skip School Home next time is remembered for the account and can be undone from the menu', async ({ page }) => {
    await mock(page)
    await page.goto('/login')
    await expect(page).toHaveURL(/\/home$/)
    await main(page).getByLabel('Skip School Home next time').check()
    await page.goto('/login')
    await expect(page).toHaveURL(/\/teacher$/)
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'School Home', exact: true }).click()
    await expect(page).toHaveURL(/\/home$/)
    await expect(main(page).getByLabel('Skip School Home next time')).toBeChecked()
    await main(page).getByLabel('Skip School Home next time').uncheck()
    await page.goto('/login')
    await expect(page).toHaveURL(/\/home$/)
  })

  test('opened from the menu with nothing published, the page says so instead of redirecting', async ({ page }) => {
    await mock(page, { home: null })
    await page.goto('/home')
    await expect(main(page).getByText('Your school has not published its home page yet.')).toBeVisible()
    await expect(main(page).getByRole('link', { name: 'Enter Dashboard' })).toBeVisible()
  })

  test('the management page is refused without the permission', async ({ page }) => {
    await mock(page)
    await page.goto('/home/manage')
    await expect(main(page).getByRole('heading', { name: 'School Home' })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'School Home management' })).toHaveCount(0)
  })

  test('an administrator reorders, hides, edits, uploads, previews and publishes', async ({ page }) => {
    const { saved, uploads } = await mock(page, { user: admin })
    await page.goto('/home/manage')
    await expect(main(page).getByRole('heading', { name: 'School Home', exact: true })).toBeVisible()
    await main(page).getByRole('button', { name: 'Move Gallery up' }).click()
    await main(page).getByRole('button', { name: 'Hide Achievements' }).click()
    await expect(main(page).getByRole('button', { name: 'Show Achievements' })).toHaveAttribute('aria-pressed', 'false')
    await main(page).getByLabel('Tagline (optional)').fill('Rooted in values')
    await page.locator('.home-image-field', { hasText: 'School logo' }).locator('input[type=file]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png })
    await expect(main(page).getByRole('button', { name: 'Remove school logo' })).toBeVisible()
    expect(uploads[0]).toContain('multipart/form-data')
    await page.locator('.home-image-field', { hasText: 'Banner image' }).locator('input[type=file]').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') })
    await expect(main(page).getByText('Choose a PNG or JPEG image.')).toBeVisible()
    expect(uploads).toHaveLength(1)
    await main(page).getByRole('button', { name: /^Motto, vision & mission/ }).click()
    await main(page).getByRole('textbox', { name: 'Motto' }).fill('Knowledge and character')
    await expect(main(page).getByText('You have unsaved changes.')).toBeVisible()

    await main(page).getByRole('button', { name: 'Preview' }).click()
    await expect(main(page).getByRole('heading', { name: 'Preview' })).toBeVisible()
    await expect(main(page).getByRole('heading', { name: 'Green Valley School' })).toBeVisible()
    expect(saved[0].action).toBe('save')
    expect(saved[0].version).toBe(3)
    expect(saved[0].draft.sections.map(s => s.key).slice(-3)).toEqual(['events', 'gallery', 'announcements'])
    expect(saved[0].draft.sections.find(s => s.key === 'achievements')?.visible).toBe(false)
    expect(saved[0].draft.hero).toMatchObject({ tagline: 'Rooted in values', logoId: image(7) })
    expect(saved[0].draft.identity.motto).toBe('Knowledge and character')
    expect(JSON.stringify(saved[0])).not.toContain(school)

    await main(page).getByRole('button', { name: 'Back to editing' }).click()
    await main(page).getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(main(page).getByRole('status')).toContainText('School Home is published.')
    expect(saved[1]).toMatchObject({ action: 'publish', version: 4 })
    await expect(main(page).getByRole('button', { name: 'Unpublish' })).toBeVisible()
  })

  for (const [width, height] of [[390, 844], [820, 1100], [1366, 800]] as const) test(`School Home and its editor fit a ${width}px screen and pass accessibility checks`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await mock(page, { user: admin })
    const scan = async (area: string) => (await new AxeBuilder({ page }).include(area).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))
    await page.goto('/home')
    await expect(main(page).getByText('Sports day')).toBeVisible()
    await expect(page.locator('.sidebar, .topbar')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Manage School Home' })).toBeVisible()
    await expect(main(page).getByRole('link', { name: 'Enter Dashboard' }).first()).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await scan('.sh-screen')).toEqual([])
    await page.goto('/home/manage')
    await expect(page.locator('.sidebar')).toBeAttached()
    for (const section of ['Hero', 'Previous year results', 'School statistics', 'Featured faculty', 'Achievements', 'Gallery']) {
      await main(page).getByRole('button', { name: new RegExp('^' + section) }).click()
      const add = main(page).getByRole('button', { name: /^Add a/ })
      if (await add.count()) await add.first().click()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), section).toBe(true)
    }
    expect(await scan('#main')).toEqual([])
  })
})
