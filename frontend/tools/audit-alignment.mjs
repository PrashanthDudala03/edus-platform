// Alignment audit: measures, in a real browser, whether pages follow the shared alignment contract.
// The LOCAL build is served with the live API (read-only). Usage: node audit-alignment.mjs <outDir> [width] [live]
// (pass "live" as the third argument to audit the running site instead). Not part of the product; safe to delete.
import { chromium, request } from 'playwright'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

const out = process.argv[2], width = Number(process.argv[3] || 1440), live = process.argv[4] === 'live'
const base = 'http://localhost:8080', dist = resolve('dist'), password = process.env.EDUOS_DEMO_PASSWORD
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }
const pages = {
  administrator: ['admin@demo.eduos.local', ['/suite/subjects', '/suite/teaching-assignments', '/teachers', '/suite/account-links', '/suite/staff-attendance', '/suite/homework', '/suite/marks', '/suite/fees', '/notifications/history', '/students', '/parents', '/suite/classes', '/suite/academic-years', '/suite/exams', '/suite/leave-requests', '/suite/circulars', '/suite/fee-structures', '/suite/timetable', '/suite/submissions', '/attendance', '/audit', '/control/users']],
  teacher: ['teacher@demo.eduos.local', ['/suite/homework', '/suite/marks', '/suite/submissions']],
  parent: ['parent@demo.eduos.local', ['/suite/fees', '/suite/marks']],
  superadmin: ['superadmin@eduos.local', ['/super-admin/schools']],
}
mkdirSync(out, { recursive: true })
const api = await request.newContext({ baseURL: base }), browser = await chromium.launch(), report = []
for (const [role, [username, paths]] of Object.entries(pages)) {
  const login = await api.post('/api/v1/auth/login', { data: { username, password, schoolId: '' } })
  if (!login.ok()) { console.log('login failed', role, login.status()); continue }
  const session = (await login.json()).data
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  await ctx.addInitScript(([s]) => { localStorage.setItem('accessToken', s.accessToken); localStorage.setItem('refreshToken', s.refreshToken); localStorage.setItem('user', JSON.stringify(s.user)); localStorage.setItem('eduos.skipSchoolHome', '1') }, [session])
  await ctx.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/api/')) return route.request().method() === 'GET' || url.pathname.endsWith('/auth/refresh') ? route.continue() : route.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"Audit is read-only."}' })
    if (live) return route.continue()
    const file = join(dist, url.pathname), served = extname(url.pathname) && existsSync(file) ? file : join(dist, 'index.html')
    return route.fulfill({ status: 200, contentType: types[extname(served)] ?? 'application/octet-stream', body: readFileSync(served) })
  })
  const page = await ctx.newPage()
  for (const path of paths) {
    await page.goto(base + path, { waitUntil: 'networkidle' }).catch(() => undefined); await page.locator('#main table, #main .empty-state').first().waitFor({ timeout: 8000 }).catch(() => undefined); await page.waitForTimeout(400)
    const found = await page.evaluate(() => {
      const problems = [], facts = {}, r = el => el.getBoundingClientRect(), near = (a, b, t = 1.5) => Math.abs(a - b) <= t
      // Where the text of a cell really starts and ends (its content box), not where its padding starts.
      const content = cell => { const box = r(cell), s = getComputedStyle(cell); return { left: box.left + parseFloat(s.paddingLeft), right: box.right - parseFloat(s.paddingRight), align: s.textAlign, cy: box.top + box.height / 2, h: box.height } }
      const main = document.querySelector('#main'), mainStyle = getComputedStyle(main), left = r(main).left + parseFloat(mainStyle.paddingLeft), right = r(main).right - parseFloat(mainStyle.paddingRight)
      // 1. Page grid: every top-level block starts and ends on the same two lines.
      for (const el of main.children) { const box = r(el); if (box.width === 0 || getComputedStyle(el).position === 'fixed') continue
        if (!near(box.left, left)) problems.push(`block ${el.className || el.tagName} starts at ${box.left.toFixed(1)}, page line is ${left.toFixed(1)}`)
        if (el.matches('.panel,.page-heading') && !el.matches('.account-card') && !near(box.right, right)) problems.push(`block ${el.className} ends at ${box.right.toFixed(1)}, page line is ${right.toFixed(1)}`) }
      // 2. Page header: the primary action sits on the title's line and ends on the page's right line.
      const h1 = document.querySelector('.page-heading h1'), action = document.querySelector('.heading-actions > *')
      if (h1 && action) { facts.title = Math.round(r(h1).top + r(h1).height / 2); facts.action = Math.round(r(action).top + r(action).height / 2)
        if (!near(facts.title, facts.action, 4)) problems.push(`primary action centre ${facts.action} is not on the title line ${facts.title}`)
        const last = [...document.querySelectorAll('.heading-actions > *')].pop(); if (!near(r(last).right, right)) problems.push(`primary action ends at ${r(last).right.toFixed(1)}, page line is ${right.toFixed(1)}`) }
      // 3. Toolbar: search and export are the same height, on one line, ending on the panel's inner right line.
      for (const bar of document.querySelectorAll('.directory-toolbar')) { const controls = [...bar.querySelectorAll('.toolbar-actions input, .toolbar-actions .button, .toolbar-actions select')].filter(el => r(el).width > 0)
        if (controls.length > 1) { const hs = controls.map(el => Math.round(r(el).height)), cs = controls.map(el => r(el).top + r(el).height / 2); facts.toolbar = hs.join('/')
          if (Math.max(...hs) - Math.min(...hs) > 1) problems.push(`toolbar controls have different heights ${hs.join('/')}`)
          if (Math.max(...cs) - Math.min(...cs) > 1.5) problems.push('toolbar controls are not on one line') }
        const first = bar.firstElementChild?.firstElementChild ?? bar.firstElementChild, panel = bar.closest('.panel'), cell = panel?.querySelector('thead th'), lastControl = controls[controls.length - 1]
        if (first && cell && !near(r(first).left, content(cell).left, 2)) problems.push(`toolbar starts at ${r(first).left.toFixed(1)}, table text starts at ${content(cell).left.toFixed(1)}`)
        const lastHead = panel?.querySelector('thead th:last-child'); if (lastControl && lastHead && !near(r(lastControl).right, content(lastHead).right, 2)) problems.push(`toolbar ends at ${r(lastControl).right.toFixed(1)}, table content ends at ${content(lastHead).right.toFixed(1)}`) }
      // 4. Tables: header and body share tracks; text starts on the same line; actions share one centre line and one right edge.
      facts.tables = 0
      for (const table of main.querySelectorAll('table')) { const heads = [...table.querySelectorAll('thead th')], rows = [...table.querySelectorAll('tbody tr')].filter(row => row.children.length === heads.length); if (!heads.length || !rows.length) continue
        facts.tables++
        heads.forEach((th, i) => { const h = content(th), name = th.textContent.trim() || 'column ' + (i + 1)
          rows.forEach((row, n) => { const td = row.children[i], c = content(td)
            if (!near(r(th).left, r(td).left, 0.6) || !near(r(th).right, r(td).right, 0.6)) problems.push(`"${name}" header track differs from row ${n + 1}`)
            const group = td.querySelector('.row-actions')
            if (group) { const kids = [...group.children].filter(el => r(el).width > 0); if (!kids.length) return
              const centres = kids.map(el => r(el).top + r(el).height / 2); if (Math.max(...centres) - Math.min(...centres) > 1.5) problems.push(`"${name}" row ${n + 1}: actions are not on one centre line`)
              const edge = r(kids[kids.length - 1]).right; if (!near(edge, c.right, 2)) problems.push(`"${name}" row ${n + 1}: actions end at ${edge.toFixed(1)}, column ends at ${c.right.toFixed(1)}`)
              const range = document.createRange(); range.selectNodeContents(th); const text = range.getBoundingClientRect()
              if (!near(text.right, c.right, 2)) problems.push(`"${name}" header text ends at ${text.right.toFixed(1)} but its actions end at ${c.right.toFixed(1)}`) }
            else if (h.align !== c.align && !(['left', 'start'].includes(h.align) && ['left', 'start'].includes(c.align))) problems.push(`"${name}" header is ${h.align}-aligned, row ${n + 1} is ${c.align}-aligned`)
            else if (['left', 'start'].includes(c.align) && !near(h.left, c.left)) problems.push(`"${name}" header text starts at ${h.left.toFixed(1)}, row ${n + 1} at ${c.left.toFixed(1)}`) }) })
        const scroller = table.closest(".table-scroll"); if (scroller && scroller.scrollWidth > scroller.clientWidth + 1) problems.push(`table is ${scroller.scrollWidth}px wide in a ${scroller.clientWidth}px panel (scrolls sideways)`)
        const heights = rows.map(row => Math.round(r(row).height)); facts.rows = [...new Set(heights)].join('/')
        const lastCells = rows.map(row => row.lastElementChild.querySelector('.row-actions')).filter(Boolean).map(g => [...g.children].filter(el => el.matches('button,a') && r(el).width > 0).map(el => Math.round(r(el).left)).join(','))
        if (new Set(lastCells.filter(Boolean)).size > 1 && new Set(rows.map(row => row.lastElementChild.querySelectorAll('button,a').length)).size === 1) problems.push('action buttons sit at different positions from row to row: ' + [...new Set(lastCells)].slice(0, 3).join(' vs ')) }
      return { problems: [...new Set(problems)].slice(0, 10), facts }
    })
    report.push({ role, path, ...found })
    await page.screenshot({ path: join(out, `${role}${path.replace(/\//g, '_')}-${width}.png`) })
  }
  await ctx.close()
}
await browser.close(); await api.dispose()
writeFileSync(join(out, `alignment-${width}.json`), JSON.stringify(report, null, 1))
let total = 0
for (const item of report) { total += item.problems.length; console.log(`${item.role} ${item.path}  tables:${item.facts.tables ?? 0} rows:${item.facts.rows ?? '-'} toolbar:${item.facts.toolbar ?? '-'} title/action:${item.facts.title ?? '-'}/${item.facts.action ?? '-'}  ${item.problems.length ? 'PROBLEMS' : 'ok'}`); for (const p of item.problems) console.log('    - ' + p) }
console.log('TOTAL PROBLEMS', total, 'on', report.filter(i => i.problems.length).length, 'of', report.length, 'pages at', width)
