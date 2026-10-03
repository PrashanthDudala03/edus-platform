// One-off desktop comparison: where the same elements sit in the RUNNING frontend (the baseline) and in the LOCAL
// build, at desktop widths, with the live API (read-only). Also clicks the header identity for every role in the
// local build. Usage: node audit-desktop.mjs <outDir>   (not part of the product; safe to delete)
import { chromium, request } from 'playwright'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

const out = process.argv[2], base = 'http://localhost:8080', dist = resolve('dist'), password = process.env.EDUOS_DEMO_PASSWORD
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }
const accounts = { administrator: 'admin@demo.eduos.local', teacher: 'teacher@demo.eduos.local', parent: 'parent@demo.eduos.local', student: 'student@demo.eduos.local', principal: 'principal@demo.eduos.local', superadmin: 'superadmin@eduos.local' }
const pages = { administrator: ['/admin', '/students', '/suite/homework', '/suite/fees', '/settings'], teacher: ['/teacher', '/suite/homework', '/suite/marks'], parent: ['/parent', '/suite/fees'], superadmin: ['/super-admin', '/super-admin/schools'] }
const selectors = ['.sidebar', '.sidebar .brand', '.nav-link', '.sidebar-bottom', '.topbar', '.breadcrumb', '.breadcrumb strong', '.date-pill', '.topbar-separator', '.user-info', '.user-info strong', '.user-info small', '.topbar .avatar', '.main-content', '.page-heading', '.page-heading h1', '.heading-actions', '.heading-actions .button', '.module-tabs', '.module-tabs a', '.directory-toolbar', '.toolbar-actions', '.toolbar-actions input', '.toolbar-actions .button', '.panel', '.panel-heading', '.stats-grid', '.stat-card', '.stat-card strong', '.dashboard-grid', 'table', 'thead th', 'tbody tr:first-child td', '.row-actions', '.row-actions > *', '.pagination', '.ai-entry', '.workspace-footer']
mkdirSync(out, { recursive: true })
const api = await request.newContext({ baseURL: base }), browser = await chromium.launch(), sessions = {}
for (const [role, username] of Object.entries(accounts)) {
  const login = await api.post('/api/v1/auth/login', { data: { username, password, schoolId: '' } })
  if (login.ok()) sessions[role] = (await login.json()).data; else console.log('login failed', role, login.status())
}
async function context(role, width, local) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  await ctx.addInitScript(([s]) => { localStorage.setItem('accessToken', s.accessToken); localStorage.setItem('refreshToken', s.refreshToken); localStorage.setItem('user', JSON.stringify(s.user)); localStorage.setItem('eduos.skipSchoolHome', '1') }, [sessions[role]])
  await ctx.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/api/')) return route.request().method() === 'GET' || url.pathname.endsWith('/auth/refresh') ? route.continue() : route.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"Audit is read-only."}' })
    if (!local) return route.continue()
    const file = join(dist, url.pathname), served = extname(url.pathname) && existsSync(file) ? file : join(dist, 'index.html')
    return route.fulfill({ status: 200, contentType: types[extname(served)] ?? 'application/octet-stream', body: readFileSync(served) })
  })
  return ctx
}
const measure = page => page.evaluate(list => Object.fromEntries(list.map(selector => [selector, [...document.querySelectorAll(selector)].slice(0, 12).map(el => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(n => Math.round(n * 2) / 2).join(',') })])), selectors)

// 1. Desktop geometry: baseline (running frontend) against the local build.
const differences = []
for (const width of [1440, 1920]) for (const [role, paths] of Object.entries(pages)) {
  const live = await context(role, width, false), local = await context(role, width, true), a = await live.newPage(), b = await local.newPage()
  for (const path of paths) {
    for (const page of [a, b]) { await page.goto(base + path, { waitUntil: 'networkidle' }).catch(() => undefined); await page.waitForTimeout(500) }
    const before = await measure(a), after = await measure(b)
    for (const selector of selectors) {
      const x = before[selector].join(' | '), y = after[selector].join(' | ')
      if (x !== y) differences.push({ width, role, path, selector, before: x.slice(0, 200), after: y.slice(0, 200) })
    }
    if (width === 1440 && ['/admin', '/suite/homework'].includes(path)) { await a.screenshot({ path: join(out, `${role}${path.replace(/\//g, '_')}-1440-before.png`) }); await b.screenshot({ path: join(out, `${role}${path.replace(/\//g, '_')}-1440-after.png`) }) }
  }
  await live.close(); await local.close()
}
// 2. The header identity in the local build: what is really under the pointer, then a real click, for every role.
const clicks = []
for (const role of Object.keys(sessions)) for (const width of [1440, 390]) {
  const ctx = await context(role, width, true), page = await ctx.newPage()
  await page.goto(base + (role === 'superadmin' ? '/super-admin' : '/suite'), { waitUntil: 'networkidle' }).catch(() => undefined)
  const probe = await page.evaluate(() => {
    const control = document.querySelector('a.identity'); if (!control) return { found: false }
    const r = control.getBoundingClientRect(), points = [[0.1, 0.5], [0.5, 0.5], [0.9, 0.5], [0.5, 0.15], [0.5, 0.85]]
    return { found: true, box: [r.x, r.y, r.width, r.height].map(Math.round).join(','), cursor: getComputedStyle(control).cursor,
      hit: points.map(([fx, fy]) => { const el = document.elementFromPoint(r.x + r.width * fx, r.y + r.height * fy); return !!el && control.contains(el) }) }
  })
  let url = ''
  if (probe.found) { const box = await page.locator('a.identity').boundingBox(); await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2); await page.waitForTimeout(400); url = new URL(page.url()).pathname }
  const heading = await page.locator('h1').first().textContent().catch(() => '')
  clicks.push({ role, width, ...probe, url, heading })
  if (width === 1440 && role === 'administrator') await page.screenshot({ path: join(out, 'administrator_account-1440.png') })
  await ctx.close()
}
await browser.close(); await api.dispose()
writeFileSync(join(out, 'desktop.json'), JSON.stringify({ differences, clicks }, null, 1))
console.log('DIFFERENCES', differences.length)
for (const d of differences.slice(0, 60)) console.log([d.width, d.role, d.path, d.selector].join('  '), '\n   before', d.before, '\n   after ', d.after)
for (const c of clicks) console.log('CLICK', c.role, c.width, c.found ? `box ${c.box} cursor ${c.cursor} hit ${c.hit.join('')}` : 'NOT FOUND', '->', c.url, '|', c.heading)
