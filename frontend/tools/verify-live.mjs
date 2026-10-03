// Post-deployment check against the REAL running site (no local files are served). Read-only: the only non-GET calls
// allowed are sign-in, token refresh and the template preview, none of which changes data.
// Usage: node verify-live.mjs baseline|verify <outDir>   (not part of the product; safe to delete)
import { chromium, request } from 'playwright'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const mode = process.argv[2], out = process.argv[3], base = 'http://localhost:8080', password = process.env.EDUOS_DEMO_PASSWORD
const accounts = { administrator: 'admin@demo.eduos.local', teacher: 'teacher@demo.eduos.local', parent: 'parent@demo.eduos.local', student: 'student@demo.eduos.local', principal: 'principal@demo.eduos.local', superadmin: 'superadmin@eduos.local' }
const selectors = ['.sidebar', '.topbar', '.breadcrumb', '.date-pill', '.user-info', '.topbar .avatar', '.main-content', '.page-heading h1', '.heading-actions .button', '.module-tabs a', '.directory-toolbar', '.toolbar-actions input', '.toolbar-actions .button', 'table', 'thead th', 'tbody tr:first-child td', 'tbody tr:first-child .row-actions > *', '.ai-entry']
mkdirSync(out, { recursive: true })
const api = await request.newContext({ baseURL: base }), browser = await chromium.launch(), sessions = {}, lines = []
const say = (...parts) => { const line = parts.join(' '); lines.push(line); console.log(line) }
for (const [role, username] of Object.entries(accounts)) {
  if (mode === 'baseline' && role !== 'administrator') continue
  const login = await api.post('/api/v1/auth/login', { data: { username, password, schoolId: '' } })
  if (login.ok()) sessions[role] = (await login.json()).data; else say('LOGIN FAILED', role, login.status())
}
async function open(role, width, height = 1000) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  await ctx.addInitScript(([s]) => { localStorage.setItem('accessToken', s.accessToken); localStorage.setItem('refreshToken', s.refreshToken); localStorage.setItem('user', JSON.stringify(s.user)); localStorage.setItem('eduos.skipSchoolHome', '1') }, [sessions[role]])
  await ctx.route('**/api/**', route => { const r = route.request(), path = new URL(r.url()).pathname
    return r.method() === 'GET' || /\/auth\/(refresh|login)$/.test(path) || path.endsWith('/preview') ? route.continue() : route.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"Verification is read-only."}' }) })
  const page = await ctx.newPage(); page.on('pageerror', error => say('PAGE ERROR', role, String(error).slice(0, 160)))
  return { ctx, page }
}
const go = async (page, path) => { await page.goto(base + path, { waitUntil: 'networkidle' }).catch(() => undefined); await page.waitForTimeout(500) }
const measure = page => page.evaluate(list => Object.fromEntries(list.map(selector => [selector, [...document.querySelectorAll(selector)].slice(0, 12).map(el => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(n => Math.round(n * 2) / 2).join(',') }).join(' | ')])), selectors)
const baselineFile = join(out, '..', 'staff-attendance-baseline.json')

if (mode === 'baseline') {
  const rects = {}
  for (const width of [1440, 1920]) { const { ctx, page } = await open('administrator', width); await go(page, '/suite/staff-attendance'); rects[width] = await measure(page); if (width === 1440) await page.screenshot({ path: join(out, 'staff-attendance-1440-before.png') }); await ctx.close() }
  writeFileSync(baselineFile, JSON.stringify(rects, null, 1)); say('baseline saved for', Object.keys(rects).join(', '))
} else {
  // 1. API smoke: the new endpoints answer, and only for who they should.
  const get = async (role, path) => (await api.get('/api/v1' + path, { headers: { Authorization: 'Bearer ' + sessions[role].accessToken } })).status()
  for (const path of ['/control/me', '/control/features', '/notifications', '/notifications/unread-count', '/notifications/preferences', '/notifications/devices', '/notifications/templates', '/notifications/templates/leave.approved', '/notifications/history', '/suite/home', '/suite/records/homework'])
    say('API administrator', path, await get('administrator', path))
  for (const role of ['teacher', 'parent', 'student', 'principal']) say('API', role, 'inbox', await get(role, '/notifications'), 'unread', await get(role, '/notifications/unread-count'), 'templates', await get(role, '/notifications/templates'), 'history', await get(role, '/notifications/history'), 'features', await get(role, '/control/features'))
  say('API superadmin inbox', await get('superadmin', '/notifications'), 'features', await get('superadmin', '/control/features'))
  const me = await (await api.get('/api/v1/control/me', { headers: { Authorization: 'Bearer ' + sessions.administrator.accessToken } })).json()
  say('administrator holds notifications.manage:', me.data.permissions.includes('notifications.manage'))
  const features = await (await api.get('/api/v1/control/features', { headers: { Authorization: 'Bearer ' + sessions.parent.accessToken } })).json()
  say('parent features:', features.data.map(f => `${f.key}=${f.enabled ? (f.allowed ? 'allowed' : 'enabled') : f.status === 'future' ? 'future' : 'off'}`).join(' '))
  const history = await (await api.get('/api/v1/notifications/history', { headers: { Authorization: 'Bearer ' + sessions.administrator.accessToken } })).json()
  say('history rows:', history.data.totalCount)
  const wrong = await api.post('/api/v1/auth/login', { data: { username: accounts.administrator, password: 'definitely-not-the-password', schoolId: '' } })
  say('wrong password:', wrong.status(), JSON.stringify(Object.keys(await wrong.json())))

  // 2. The identity block, clicked for real at three places (name, role, avatar), for every role: each opens the
  //    profile card under the header; the card closes on Escape and on an outside click; View profile opens My account.
  for (const role of Object.keys(sessions)) for (const width of [1440, 390]) {
    const { ctx, page } = await open(role, width, width === 390 ? 844 : 1000), results = [], card = page.getByRole('dialog', { name: 'My account' })
    await go(page, role === 'superadmin' ? '/super-admin' : '/suite')
    const layout = () => page.evaluate(() => [...document.querySelectorAll('.topbar-right > *, .breadcrumb, #main > *')].map(el => { const r = el.getBoundingClientRect(); return Math.round(r.x) + ',' + Math.round(r.y) }).join(';'))
    const before = await layout()
    for (const [part, selector] of [['name', 'button.identity .user-info strong'], ['role', 'button.identity .user-info small'], ['avatar', 'button.identity .avatar']]) {
      const box = await page.locator(selector).boundingBox().catch(() => null)
      if (!box) { results.push(part + ':NOT FOUND'); continue }
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(250)
      const opened = await card.isVisible()
      await page.keyboard.press('Escape'); await page.waitForTimeout(150)
      results.push(part + (opened && !(await card.isVisible()) ? ':card' : ':FAILED'))
    }
    await page.locator('button.identity').click(); await page.waitForTimeout(250)
    const place = await card.boundingBox(), anchor = await page.locator('button.identity').boundingBox(), moved = (await layout()) !== before
    const text = (await card.textContent() || '').replace(/\s+/g, ' ').slice(0, 150)
    if (width === 1440 && ['administrator', 'parent'].includes(role) || width === 390 && role === 'teacher') await page.screenshot({ path: join(out, `profile-card-${role}-${width}.png`) })
    await page.mouse.click(20, width === 390 ? 700 : 600); await page.waitForTimeout(200)
    const closedOutside = !(await card.isVisible())
    await page.locator('button.identity').click(); await card.getByRole('link', { name: 'View profile' }).click(); await page.waitForTimeout(500)
    say('PROFILE CARD', role, width, results.join(' '), '| inside screen:', place.x >= 0 && place.x + place.width <= width + 1, '| below header:', place.y >= anchor.y + anchor.height - 2, '| right edges', Math.round(place.x + place.width), 'vs', Math.round(anchor.x + anchor.width), '| page moved:', moved, '| outside click closes:', closedOutside, '| View profile ->', new URL(page.url()).pathname, (await page.locator('h1').first().textContent()) === 'My account' ? 'ok' : 'WRONG', '|', JSON.stringify(text))
    await ctx.close()
  }

  // 3. Notification administration in the real menu, as the Administrator.
  { const { ctx, page } = await open('administrator', 1440)
    await go(page, '/admin')
    const group = page.locator('.nav-section', { hasText: 'Notifications' })
    say('MENU group links:', JSON.stringify(await group.locator('a').allTextContents()))
    await group.getByRole('link', { name: 'Notification wording' }).click(); await page.waitForTimeout(800)
    const names = await page.getByRole('region', { name: 'Notifications' }).getByRole('button').allTextContents()
    say('WORDING url', new URL(page.url()).pathname, '| templates', names.length, '| not sent yet:', names.filter(n => n.includes('not sent yet')).length, '| school wording:', names.filter(n => n.includes("Your school's")).length)
    const options = await page.getByLabel('Channel').locator('option').evaluateAll(list => list.map(o => o.textContent + (o.disabled ? ' [disabled]' : '')))
    say('WORDING channels:', options.join('; '))
    say('WORDING title:', JSON.stringify(await page.getByLabel('Title').inputValue()), '| message:', JSON.stringify(await page.getByLabel('Message').inputValue()), '| source tag:', await page.locator('.panel-heading .status-tag').last().textContent())
    say('WORDING variables:', (await page.locator('.template-variables li button').allTextContents()).join(' '))
    say('WORDING buttons:', JSON.stringify(await page.locator('.template-actions button').evaluateAll(list => list.map(b => b.textContent + (b.disabled ? ' [disabled]' : '')))), '| default shown:', await page.locator('.template-default').count())
    await page.getByRole('button', { name: 'Preview' }).click(); await page.waitForTimeout(900)
    say('WORDING preview:', JSON.stringify((await page.locator('.template-preview').textContent().catch(() => 'NO PREVIEW'))?.slice(0, 160)))
    await page.getByRole('region', { name: 'Notifications' }).getByRole('button', { name: /Leave approved/ }).click(); await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Preview' }).click(); await page.waitForTimeout(900)
    say('WORDING leave.approved preview:', JSON.stringify((await page.locator('.template-preview').textContent().catch(() => 'NO PREVIEW'))?.slice(0, 160)))
    await page.screenshot({ path: join(out, 'notification-wording-1440.png') })
    await group.getByRole('link', { name: 'Delivery history' }).click(); await page.waitForTimeout(800)
    say('HISTORY url', new URL(page.url()).pathname, '| heading:', await page.locator('h1').first().textContent(), '| body:', JSON.stringify((await page.getByRole('region', { name: 'Sent notifications' }).textContent().catch(() => 'NO REGION'))?.slice(0, 120)))
    await page.screenshot({ path: join(out, 'delivery-history-1440.png') })
    await ctx.close() }
  for (const role of ['teacher', 'parent']) { const { ctx, page } = await open(role, 1440); await go(page, '/suite'); const links = await page.locator('.nav-section', { hasText: 'Notifications' }).locator('a').count(); await go(page, '/notifications/templates')
    say('MENU', role, 'notification links:', links, '| direct url shows wording:', await page.getByRole('heading', { name: 'Notification wording' }).count()); await ctx.close() }

  // 4. Staff attendance: desktop identical to before the deployment; a phone gets cards.
  const before = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8')) : {}
  for (const width of [1920, 1440, 390]) {
    const { ctx, page } = await open('administrator', width, width === 390 ? 844 : 1000); await go(page, '/suite/staff-attendance')
    const facts = await page.evaluate(() => { const row = document.querySelector('tbody tr'), acts = [...document.querySelectorAll('tbody tr:first-child .row-actions > *')].map(el => el.getBoundingClientRect())
      return { rowDisplay: row ? getComputedStyle(row).display : 'none', headVisible: !!document.querySelector('thead th') && document.querySelector('thead th').getBoundingClientRect().width > 2, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        tableOverflow: (() => { const t = document.querySelector('.table-scroll'); return t ? t.scrollWidth - t.clientWidth : 0 })(), actions: acts.length, oneLine: acts.length ? Math.max(...acts.map(r => r.y + r.height / 2)) - Math.min(...acts.map(r => r.y + r.height / 2)) < 6 : null, labels: [...document.querySelectorAll('tbody tr:first-child td')].map(td => td.getAttribute('data-label')).join(',') } })
    let same = ''
    if (before[width]) { const now = await measure(page); const moved = selectors.filter(s => before[width][s] !== now[s]); same = moved.length ? ' | MOVED: ' + moved.map(s => `${s} ${before[width][s]} -> ${now[s]}`).join(' ; ').slice(0, 500) : ' | positions identical to before deployment (' + selectors.length + ' element groups)' }
    say('STAFF ATTENDANCE', width, JSON.stringify(facts) + same)
    await page.screenshot({ path: join(out, `staff-attendance-${width}.png`) }); await ctx.close()
  }
}
await browser.close(); await api.dispose()
writeFileSync(join(out, mode + '.txt'), lines.join('\n'))
