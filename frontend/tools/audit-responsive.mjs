// One-off responsive audit: the LOCAL build (dist) against the live API, read-only, for each demo role.
// Usage: node audit-responsive.mjs <outDir> [width] [role,role]   (not part of the product; safe to delete)
import { chromium, request } from 'playwright'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

const out = process.argv[2], width = Number(process.argv[3] || 390), only = (process.argv[4] || '').split(',').filter(Boolean)
const base = 'http://localhost:8080', dist = resolve('dist'), password = process.env.EDUOS_DEMO_PASSWORD
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }
const roles = {
  teacher: ['teacher@demo.eduos.local', ['/teacher', '/suite/homework', '/suite/submissions', '/suite/marks', '/suite/register', '/suite/exams', '/suite/leave-requests', '/account']],
  parent: ['parent@demo.eduos.local', ['/parent', '/suite/homework', '/suite/fees', '/suite/marks', '/suite/circulars', '/account']],
  student: ['student@demo.eduos.local', ['/student', '/suite/homework', '/suite/timetable', '/account']],
  principal: ['principal@demo.eduos.local', ['/principal', '/suite/leave-requests', '/attendance', '/account']],
  admin: ['admin@demo.eduos.local', ['/admin', '/students', '/suite/homework', '/suite/fees', '/control', '/settings', '/account']],
  superadmin: ['superadmin@eduos.local', ['/super-admin', '/super-admin/schools', '/super-admin/account']],
}
mkdirSync(out, { recursive: true })
const api = await request.newContext({ baseURL: base })
const browser = await chromium.launch()
const report = []
for (const [role, [username, paths]] of Object.entries(roles)) {
  if (only.length && !only.includes(role)) continue
  const login = await api.post('/api/v1/auth/login', { data: { username, password, schoolId: '' } })
  if (!login.ok()) { report.push({ role, error: 'login ' + login.status() }); continue }
  const session = (await login.json()).data
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  await context.addInitScript(([s]) => { localStorage.setItem('accessToken', s.accessToken); localStorage.setItem('refreshToken', s.refreshToken); localStorage.setItem('user', JSON.stringify(s.user)); localStorage.setItem('eduos.skipSchoolHome', '1') }, [session])
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/api/')) return route.request().method() === 'GET' || url.pathname.endsWith('/auth/refresh') ? route.continue() : route.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"Audit is read-only."}' })
    const file = join(dist, url.pathname), served = extname(url.pathname) && existsSync(file) ? file : join(dist, 'index.html')
    return route.fulfill({ status: 200, contentType: types[extname(served)] ?? 'application/octet-stream', body: readFileSync(served) })
  })
  const page = await context.newPage()
  for (const path of paths) {
    await page.goto(base + path, { waitUntil: 'networkidle' }).catch(() => undefined)
    await page.waitForTimeout(400)
    const found = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth, describe = el => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '')
      const wide = [...document.querySelectorAll('#main *, header *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1) && !el.closest('.table-scroll,.module-tabs,.sw-people') }).slice(0, 6).map(describe)
      // Compact sibling controls that sit one under another although they would fit side by side.
      const stacked = []
      for (const box of document.querySelectorAll('#main div, #main td, #main li, #main footer, #main section')) {
        const kids = [...box.children].filter(el => el.matches('button,a.button,a.text-link,.icon-button') && el.getBoundingClientRect().width > 0)
        if (kids.length < 2 || kids.length !== box.children.length && box.children.length > kids.length + 1) continue
        const rects = kids.map(el => el.getBoundingClientRect()), tops = new Set(rects.map(r => Math.round((r.top + r.height / 2) / 12)))
        const natural = kids.reduce((sum, el) => { const clone = el.cloneNode(true); clone.style.cssText = 'position:absolute;visibility:hidden;width:auto;flex:none'; document.body.appendChild(clone); const w = clone.getBoundingClientRect().width; clone.remove(); return sum + w + 8 }, 0)
        if (tops.size === kids.length && natural <= box.getBoundingClientRect().width) stacked.push(describe(box) + ' > ' + kids.map(el => (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 14)).join(' / '))
      }
      const scrollers = [...document.querySelectorAll('.table-scroll')].filter(el => el.scrollWidth > el.clientWidth + 2).map(el => el.scrollWidth + 'px table in ' + el.clientWidth + 'px')
      const identity = document.querySelector('.topbar-right'); const ir = identity?.getBoundingClientRect()
      return { doc: document.documentElement.scrollWidth, vw, wide, stacked: [...new Set(stacked)].slice(0, 8), scrollers, identityRight: ir ? Math.round(ir.right) : null, heading: document.querySelector('h1')?.textContent ?? '' }
    })
    const name = role + path.replace(/\//g, '_') + '-' + width + '.png'
    await page.screenshot({ path: join(out, name), fullPage: false })
    report.push({ role, path, ...found, overflow: found.doc > found.vw + 1 })
  }
  await context.close()
}
await browser.close(); await api.dispose()
writeFileSync(join(out, 'report-' + width + '.json'), JSON.stringify(report, null, 1))
for (const r of report) console.log([r.role, r.path, r.error || '', r.overflow ? 'OVERFLOW ' + r.doc + '>' + r.vw : 'ok', r.wide?.length ? 'wide:' + r.wide.join('|') : '', r.stacked?.length ? 'STACKED:' + r.stacked.join(' || ') : '', r.scrollers?.length ? 'scroll:' + r.scrollers.join(',') : ''].filter(Boolean).join('  '))
