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
const policy = "default-src 'self'; script-src 'self' https://checkout.razorpay.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.razorpay.com; connect-src 'self' https://*.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com; font-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"
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
type Options = { user?: User, home?: unknown, signedIn?: boolean, homeStatus?: number, motion?: boolean, slowUploads?: boolean }
type Saved = { draft: ReturnType<typeof draft>, version: number, action: string }

async function mock(page: Page, options: Options = {}) {
  const user = options.user ?? teacher, saved: Saved[] = [], uploads: string[] = []
  // Sections ease in as they are reached; with reduced motion everything is in place at once, which is what most checks need.
  if (!options.motion) await page.emulateMedia({ reducedMotion: 'reduce' })
  if (options.signedIn !== false) await page.addInitScript(([stored]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('accessToken', 'test-access-token'); localStorage.setItem('refreshToken', 'test-refresh-token'); localStorage.setItem('user', stored); sessionStorage.setItem('seeded', '1') } }, [JSON.stringify(user)])
  const json = (route: Route, data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status < 400 ? { data } : { message: 'Unhandled exception at db.internal:5432' }) })
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api/v1', ''), method = request.method()
    if (path === '/auth/login') return json(route, { accessToken: 'test-access-token', refreshToken: 'test-refresh-token', expiresIn: 900, user })
    if (path === '/control/me') return json(route, user)
    if (path === '/suite/home' && method === 'GET') return json(route, { home: options.home === undefined ? published : options.home, canManage: user.permissions.includes('school-home.manage') }, options.homeStatus ?? 200)
    if (path === '/suite/home' && method === 'PUT') { const body = request.postDataJSON() as Saved; saved.push(body); return json(route, { draft: body.draft, version: body.version + 1, published: body.action === 'publish', publishedAt: body.action === 'publish' ? '2026-10-02T06:00:00Z' : null, pending: body.action !== 'publish' }) }
    if (path === '/suite/home/manage') return json(route, { draft: draft(), version: 3, published: false, publishedAt: null, pending: true, teachers: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', label: 'Asha Rao' }] })
    if (path === '/suite/home/preview') return json(route, { ...published, brand: { primary: '#7a1f2b', accent: '#d4a53a' } })
    if (path === '/suite/home/images' && method === 'POST') { uploads.push(request.headers()['content-type'] ?? ''); const id = image(6 + uploads.length); if (options.slowUploads) await new Promise(done => setTimeout(done, uploads.length === 1 ? 900 : 150)); return json(route, { id }, 201) }
    if (path.startsWith('/suite/home/images/')) return route.fulfill({ status: 200, contentType: 'image/png', body: png })
    if (url.pathname.startsWith('/api/')) return json(route, path.endsWith('/school') ? { name: 'Green Valley School' } : [])
    if (!existsSync(dist)) return route.continue()
    const file = join(dist, url.pathname)
    const served = extname(url.pathname) && existsSync(file) ? file : join(dist, 'index.html')
    return route.fulfill({ status: 200, contentType: types[extname(served)] ?? 'application/octet-stream', headers: extname(served) === '.html' ? { 'Content-Security-Policy': policy } : {}, body: readFileSync(served) })
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
    await expect(main(page).getByRole('heading', { name: 'Welcome to Green Valley School', exact: true })).toBeVisible()
    await expect(main(page).getByText(/^Good (morning|afternoon|evening), Asha$/)).toBeVisible()
    for (const text of ['Learning with purpose', 'Knowledge and character', 'Welcome to a new year of learning.', 'Dr. Kavita Menon', '98.5%', '1,250', '25+', 'Head of Science · Science', 'State science fair winners', 'Annual Day', 'Winter uniform from Monday', 'Sports day'])
      await expect(main(page).getByText(text, { exact: true })).toBeVisible()
    await expect(main(page).getByRole('img', { name: 'Green Valley School logo' })).toBeVisible()
    // Every image is really drawn: none is refused by the content security policy.
    await expect.poll(() => page.locator('.sw img').evaluateAll(images => images.length > 5 && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
    await expect(page.locator('.sw-foot')).toContainText('Knowledge and character')
    // Standalone: no sidebar, workspace top bar, breadcrumb or assistant button, and no edit shortcut for a role without the permission.
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0)
    await expect(page.locator('.sidebar, .topbar, .breadcrumb, .ai-entry')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Edit School Home' })).toHaveCount(0)
    await expect(page.getByText('Powered by EduOS')).toBeVisible()
    // Events and announcements sit next to each other, so they share one block.
    await expect(main(page).locator('.sw-news')).toHaveCount(1)
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
    await main(page).getByRole('textbox', { name: 'Motto (shown on the banner)' }).fill('Knowledge and character')
    await expect(main(page).getByText('You have unsaved changes.')).toBeVisible()

    // Preview saves the draft, then opens the same standalone page the school will see, with a clear way back.
    await main(page).getByRole('button', { name: 'Preview' }).click()
    await expect(page).toHaveURL(/\/home\/preview$/)
    await expect(main(page).getByRole('heading', { name: 'Welcome to Green Valley School', exact: true })).toBeVisible()
    await expect(page.locator('.sidebar, .topbar, .ai-entry')).toHaveCount(0)
    await expect(page.getByRole('status')).toContainText('Preview of your saved draft')
    await expect(main(page).getByLabel('Skip School Home next time')).toHaveCount(0)
    // The school's own colours drive the page; a light accent gets dark text so the button stays readable.
    const theme = await page.locator('.sw').evaluate(node => { const style = getComputedStyle(node); return { primary: style.getPropertyValue('--sw-primary'), accent: style.getPropertyValue('--sw-accent'), onAccent: style.getPropertyValue('--sw-on-accent') } })
    expect(theme).toEqual({ primary: '#7a1f2b', accent: '#d4a53a', onAccent: '#14211c' })
    expect((await new AxeBuilder({ page }).include('.sw').withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map(v => v.id)).toEqual([])
    expect(saved[0].action).toBe('save')
    expect(saved[0].version).toBe(3)
    expect(saved[0].draft.sections.map(s => s.key).slice(-3)).toEqual(['events', 'gallery', 'announcements'])
    expect(saved[0].draft.sections.find(s => s.key === 'achievements')?.visible).toBe(false)
    expect(saved[0].draft.hero).toMatchObject({ tagline: 'Rooted in values', logoId: image(7) })
    expect(saved[0].draft.identity.motto).toBe('Knowledge and character')
    expect(JSON.stringify(saved[0])).not.toContain(school)

    await page.getByRole('link', { name: 'Back to management' }).click()
    await expect(page).toHaveURL(/\/home\/manage$/)
    await expect(page.locator('.sidebar')).toBeAttached()
    await main(page).getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(main(page).getByRole('status')).toContainText('School Home is published.')
    expect(saved[1]).toMatchObject({ action: 'publish' })
    await expect(main(page).getByRole('button', { name: 'Unpublish' })).toBeVisible()
  })

  test('sections ease in as they are reached, and the gallery takes several photographs at once', async ({ page }) => {
    const { uploads } = await mock(page, { user: admin, motion: true })
    await page.goto('/home')
    const gallery = page.locator('.sw-gallery').locator('xpath=ancestor::*[@data-reveal]')
    await expect(page.locator('.sw.sw-motion')).toHaveCount(1)
    await expect(gallery).toHaveCSS('opacity', '0')
    await gallery.scrollIntoViewIfNeeded()
    await expect(gallery).toHaveCSS('opacity', '1')
    await page.goto('/home/manage')
    await main(page).getByRole('button', { name: /^Gallery/ }).click()
    await page.locator('.home-image-field', { hasText: 'Upload photographs' }).locator('input[type=file]').setInputFiles([{ name: 'one.png', mimeType: 'image/png', buffer: png }, { name: 'two.jpg', mimeType: 'image/jpeg', buffer: png }, { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') }])
    await expect(main(page).getByRole('group', { name: 'Photograph 2' })).toBeVisible()
    await expect(main(page).getByText('notes.pdf: Choose a PNG or JPEG image.')).toBeVisible()
    expect(uploads).toHaveLength(2)
  })

  test('an upload that finishes late never undoes edits made in the meantime', async ({ page }) => {
    const { saved } = await mock(page, { user: admin, slowUploads: true })
    await page.goto('/home/manage')
    const field = (label: string) => page.locator('.home-image-field', { hasText: label })
    // The banner upload is slow; the logo is uploaded and the tagline typed before it returns.
    await field('Banner image').locator('input[type=file]').setInputFiles({ name: 'banner.png', mimeType: 'image/png', buffer: png })
    await field('School logo').locator('input[type=file]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png })
    await main(page).getByLabel('Tagline (optional)').fill('Typed while uploading')
    await expect(main(page).getByRole('button', { name: 'Remove school logo' })).toBeVisible()
    await expect(main(page).getByRole('button', { name: 'Remove banner image' })).toBeVisible()
    await main(page).getByRole('button', { name: 'Save draft' }).click()
    await expect(main(page).getByRole('status')).toContainText('Draft saved')
    expect(saved[0].draft.hero).toMatchObject({ tagline: 'Typed while uploading', bannerId: image(7), logoId: image(8) })
  })

  test('the preview is refused without the manage permission', async ({ page }) => {
    await mock(page)
    await page.goto('/home/preview')
    await expect(page.locator('.sw')).toHaveCount(0)
    await expect(page.locator('.sidebar')).toBeAttached()
  })

  for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [360, 740]] as const) test(`School Home and its editor fit a ${width}px screen and pass accessibility checks`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await mock(page, { user: admin })
    const scan = async (area: string) => (await new AxeBuilder({ page }).include(area).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))
    await page.goto('/home')
    await expect(main(page).getByText('Sports day')).toBeVisible()
    await expect(page.locator('.sidebar, .topbar')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Edit School Home' })).toBeVisible()
    await expect(main(page).getByRole('link', { name: 'Enter Dashboard' }).first()).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await scan('.sw')).toEqual([])
    // The header stays in place, so Enter Dashboard is reachable from anywhere on the page.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2))
    await expect(page.locator('.sw-bar').getByRole('link', { name: 'Enter Dashboard' })).toBeInViewport()
    for (const target of await page.locator('.sw-bar a, .sw-bar button').all()) { const box = await target.boundingBox(); expect(Math.min(box!.width, box!.height), 'touch target').toBeGreaterThanOrEqual(40) }
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
