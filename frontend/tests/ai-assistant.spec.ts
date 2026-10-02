import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

// Ask EduOS AI in a real browser with the whole API mocked: no AI service, model or account is needed.
// When a local build exists (npm run build) the pages are served from it, so no server is needed either;
// otherwise they come from the running frontend at the configured base URL.
const dist = resolve(process.cwd(), 'dist')
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }
const school = '11111111-1111-4111-8111-111111111111'
const teacher = { id: '22222222-2222-4222-8222-222222222222', username: 'asha.teacher', email: 'asha@example.test', firstName: 'Asha', lastName: 'Rao', schoolId: school, roles: ['Teacher'], dataScope: 'teacher', permissions: ['ai.assistant.use', 'timetable.view'] }
const answered = {
  available: true, answer: 'Students must maintain at least 75% attendance in every term.', model: 'internal-model-name', finish: 'completed',
  sources: [{ number: 1, documentId: '7c1d0000-0000-4000-8000-0000000000d1', title: 'Attendance Policy', source: 'attendance-policy.md', section: 'Attendance', page: 3 }],
  usage: { inputTokens: 239, outputTokens: 23, estimated: false },
}
type Asked = { url: string, body: Record<string, unknown>, authorization: string | undefined }
type Options = { user?: typeof teacher, status?: unknown, onStatus?: () => void, reply?: (asked: Asked, count: number) => Promise<{ status?: number, data?: unknown }> | { status?: number, data?: unknown } }

async function open(page: Page, options: Options = {}) {
  const user = options.user ?? teacher, asked: Asked[] = []
  await page.addInitScript(([stored]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('accessToken', 'test-access-token'); localStorage.setItem('refreshToken', 'test-refresh-token'); localStorage.setItem('user', stored); sessionStorage.setItem('seeded', '1') } }, [JSON.stringify(user)])
  const json = (route: Route, data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ data }) })
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname === '/api/v1/ai/assistant/ask') {
      const call = { url: url.pathname + url.search, body: request.postDataJSON(), authorization: request.headers()['authorization'] }
      asked.push(call)
      const result = await (options.reply?.(call, asked.length) ?? { data: answered })
      return result.status && result.status !== 200 ? route.fulfill({ status: result.status, contentType: 'application/json', body: JSON.stringify(result.data ?? { message: 'Unhandled exception: Npgsql.PostgresException at db.internal:5432' }) }) : json(route, result.data)
    }
    if (url.pathname === '/api/v1/ai/status') { options.onStatus?.(); return json(route, options.status ?? { enabled: true, reason: null }) }
    if (url.pathname === '/api/v1/control/me') return json(route, user)
    if (url.pathname.startsWith('/api/')) return json(route, url.pathname.endsWith('/school') ? { name: 'Green Valley School' } : [])
    if (!existsSync(dist)) return route.continue()
    const file = join(dist, url.pathname)
    const served = extname(url.pathname) && existsSync(file) ? file : join(dist, 'index.html')
    return route.fulfill({ status: 200, contentType: types[extname(served)] ?? 'application/octet-stream', body: readFileSync(served) })
  })
  // A page that needs no data of its own: the shell and its top bar are what is under test.
  await page.goto('/audit')
  return asked
}
const entry = (page: Page) => page.getByRole('button', { name: 'Ask EduOS AI' })
const panel = (page: Page) => page.getByRole('dialog', { name: 'Ask EduOS AI' })
const input = (page: Page) => panel(page).getByLabel('Your question')
const send = (page: Page) => panel(page).getByRole('button', { name: 'Send question' })
async function ask(page: Page, question: string) { await input(page).fill(question); await send(page).click() }

test.describe('Ask EduOS AI', () => {
  // Demo visibility (SHOW_AI_DEMO_ENTRY): the button is shown to everyone signed in. Using it still needs the permission.
  for (const [name, user] of [
    ['a school user without the permission', { ...teacher, permissions: ['timetable.view', 'ai.knowledge.manage'] }],
    ['the platform administrator', { ...teacher, roles: ['SuperAdmin'], dataScope: 'platform', permissions: ['platform.manage', 'ai.assistant.use'] }],
  ] as const) test(`${name} can open the panel but is told it is not enabled, and nothing is asked`, async ({ page }) => {
    let statusCalls = 0
    const asked = await open(page, { user: user as typeof teacher, onStatus: () => { statusCalls++ } })
    await expect(entry(page)).toBeVisible()
    await entry(page).click()
    await expect(panel(page).locator('.ai-banner')).toHaveText('EduOS AI is not enabled for your account yet.')
    await expect(input(page)).toBeDisabled()
    await expect(send(page)).toBeDisabled()
    await expect(panel(page).getByRole('button', { name: 'Summarize the leave policy.' })).toBeDisabled()
    // No assistant request and no status request is made for a user known to lack the permission.
    await page.waitForTimeout(300)
    expect(asked).toHaveLength(0)
    expect(statusCalls).toBe(0)
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
  })

  test('floats at the bottom right, clear of the page content and the footer text', async ({ page }) => {
    await open(page)
    const size = page.viewportSize()!, box = (await entry(page).boundingBox())!
    await expect(entry(page)).toHaveText('Ask EduOS AI')
    expect(Math.round(size.width - (box.x + box.width))).toBe(24)
    expect(Math.round(size.height - (box.y + box.height))).toBe(24)
    expect(await entry(page).evaluate(element => getComputedStyle(element).position)).toBe('fixed')
    // It is not in the top bar any more, and it does not sit on the footer's text or the page's main action.
    await expect(page.locator('.topbar .ai-entry')).toHaveCount(0)
    for (const other of [page.locator('.workspace-footer span').last(), page.getByRole('link', { name: /Go to my/ })]) {
      const b = (await other.boundingBox())!
      expect(b.x + b.width <= box.x || b.y + b.height <= box.y || b.y >= box.y + box.height).toBe(true)
    }
  })

  test('opens from the top bar with a welcome that claims only what exists', async ({ page }) => {
    await open(page)
    await expect(panel(page)).toHaveCount(0)
    await entry(page).click()
    await expect(panel(page)).toBeVisible()
    await expect(panel(page).getByRole('heading', { name: 'EduOS AI', exact: true })).toBeVisible()
    await expect(panel(page)).toContainText("Ask about your school's documents and policies, school information your account can see, or general study topics.")
    await expect(panel(page)).toContainText('General answers are not specific to your school. It cannot look up individual people yet.')
    await expect(panel(page)).toContainText('this conversation is not saved')
    await expect(input(page)).toBeFocused()
    await expect(send(page)).toBeDisabled()
    // Nothing about the machinery behind it.
    await expect(panel(page)).not.toContainText(/qwen|llama|bge|embedding|vector|model|provider|8091|8092/i)
    // An example fills the box; it is not sent until the user sends it.
    await panel(page).getByRole('button', { name: 'Summarize the leave policy.' }).click()
    await expect(input(page)).toHaveValue('Summarize the leave policy.')
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    await expect(entry(page)).toBeFocused()
  })

  test('sends only the question and shows the answer with the sources the backend listed', async ({ page }) => {
    const asked = await open(page)
    await entry(page).click()
    await ask(page, '  What attendance is required?  ')
    await expect(panel(page).locator('.from-user')).toHaveText('What attendance is required?')
    await expect(panel(page).locator('.from-assistant.answer p')).toHaveText('Students must maintain at least 75% attendance in every term.')
    const source = panel(page).locator('.ai-sources li')
    await expect(source).toHaveCount(1)
    await expect(source).toContainText('Attendance Policy')
    await expect(source).toContainText('Attendance · Page 3 · attendance-policy.md')
    // The request: the existing endpoint, the session's token, and a body with the question alone.
    expect(asked).toHaveLength(1)
    expect(asked[0]).toEqual({ url: '/api/v1/ai/assistant/ask', body: { question: 'What attendance is required?' }, authorization: 'Bearer test-access-token' })
    // No identifier, model name or usage figure is displayed.
    await expect(panel(page)).not.toContainText(/7c1d0000|internal-model-name|239|documentId|estimated/)
    await expect(input(page)).toHaveValue('')
    await expect(input(page)).toBeFocused()
  })

  test('shows what an answer is based on without naming anything internal', async ({ page }) => {
    const replies = [
      { available: true, kind: 'general', answer: 'Photosynthesis is how plants make food from light.', sources: [], model: 'internal-model-name', finish: 'completed' },
      { available: true, kind: 'live', answer: 'There are 40 students enrolled in your school.', sources: [{ number: 1, documentId: null, title: 'Student records', source: 'Live EduOS data', section: null, page: null }], model: null, finish: 'completed' },
      { available: true, kind: 'assistant', answer: "I can't look up personal details about you or about individual students, parents or staff yet.", sources: [], model: null, finish: 'completed' },
    ]
    const asked = await open(page, { reply: (_, count) => ({ data: replies[count - 1] }) })
    await entry(page).click()
    await ask(page, 'Explain photosynthesis')
    const answers = panel(page).locator('.from-assistant.answer')
    await expect(answers.nth(0).locator('.ai-note')).toHaveText('General knowledge, not specific to your school.')
    await expect(answers.nth(0).locator('.ai-sources')).toHaveCount(0)
    await ask(page, 'How many students are there?')
    await expect(answers.nth(1).locator('p')).toHaveText('There are 40 students enrolled in your school.')
    await expect(answers.nth(1).locator('.ai-sources li')).toContainText('Student records')
    await expect(answers.nth(1).locator('.ai-sources li')).toContainText('Live EduOS data')
    await expect(answers.nth(1).locator('.ai-note')).toHaveCount(0)
    await ask(page, 'tell me about myself')
    await expect(answers.nth(2).locator('p')).toContainText("I can't look up personal details")
    // The same request for every kind of question, and no route, tool or model name on screen.
    expect(asked.map(a => Object.keys(a.body))).toEqual([['question'], ['question'], ['question']])
    await expect(panel(page)).not.toContainText(/student_count|attendance_summary|fee_summary|exam_schedule|internal-model-name|\blive\b|documents"|"kind"|\bgeneral"|tool/i)
  })

  test('Enter sends and Shift+Enter starts a new line', async ({ page }) => {
    const asked = await open(page)
    await entry(page).click()
    await input(page).fill('First line')
    await input(page).press('Shift+Enter')
    await input(page).pressSequentially('second line')
    await expect(input(page)).toHaveValue('First line\nsecond line')
    expect(asked).toHaveLength(0)
    await input(page).press('Enter')
    await expect(panel(page).locator('.from-assistant.answer')).toHaveCount(1)
    expect(asked.map(a => a.body)).toEqual([{ question: 'First line\nsecond line' }])
    // Enter on an empty box sends nothing.
    await input(page).press('Enter')
    expect(asked).toHaveLength(1)
  })

  for (const [name, data, shown] of [
    ['insufficient knowledge', { available: false, reason: 'insufficient-knowledge' }, "I couldn't find enough information in your school's available knowledge to answer that."],
    ['provider unavailable', { available: false, reason: 'provider-unavailable' }, 'EduOS AI is temporarily unavailable. Please try again later.'],
    ['retrieval unavailable', { available: false, reason: 'retrieval-unavailable' }, 'EduOS AI is temporarily unavailable. Please try again later.'],
    ['rate limited', { available: false, reason: 'rate-limited', retryAfterSeconds: 45 }, "You're asking quickly. Please wait 45 seconds and try again."],
    ['school disabled', { available: false, reason: 'school-disabled' }, 'EduOS AI is not currently enabled for your school.'],
    ['an unknown reason', { available: false, reason: 'kernel-panic: Npgsql timeout at db.internal' }, 'EduOS AI could not answer just now. Please try again.'],
  ] as const) test(`shows a friendly message for ${name} and never the reason itself`, async ({ page }) => {
    await open(page, { reply: () => ({ data }) })
    await entry(page).click()
    await ask(page, 'When is sports day?')
    const notice = panel(page).locator('.from-assistant.notice')
    await expect(notice).toContainText(shown)
    await expect(panel(page).locator('.ai-sources')).toHaveCount(0)
    await expect(panel(page)).not.toContainText(/insufficient-knowledge|provider-unavailable|retrieval-unavailable|rate-limited|school-disabled|kernel-panic|Npgsql|db\.internal/)
    // The user can ask again.
    await expect(input(page)).toBeEnabled()
  })

  test('a server error or a refused request shows a safe message and nothing from the response', async ({ page }) => {
    await open(page, { reply: (_, count) => ({ status: count === 1 ? 500 : count === 2 ? 400 : 403 }) })
    await entry(page).click()
    await ask(page, 'When is sports day?')
    await expect(panel(page).locator('.from-assistant.notice').nth(0)).toContainText('EduOS AI is temporarily unavailable. Please try again later.')
    await ask(page, 'When is sports day?')
    await expect(panel(page).locator('.from-assistant.notice').nth(1)).toContainText('That question could not be processed. Try asking it in fewer words.')
    await ask(page, 'When is sports day?')
    await expect(panel(page).locator('.from-assistant.notice').nth(2)).toContainText('EduOS AI is not available for your account.')
    await expect(panel(page)).not.toContainText(/Unhandled|Npgsql|PostgresException|db\.internal|5432|500|403/)
  })

  test('explains when the school has no AI and does not let a question be sent', async ({ page }) => {
    const asked = await open(page, { status: { enabled: false, reason: 'school-disabled' } })
    await entry(page).click()
    await expect(panel(page).locator('.ai-banner')).toHaveText('EduOS AI is not currently enabled for your school. Your school administrator can tell you more.')
    await expect(input(page)).toBeDisabled()
    await expect(send(page)).toBeDisabled()
    await expect(panel(page).getByRole('button', { name: 'Summarize the leave policy.' })).toBeDisabled()
    expect(asked).toHaveLength(0)
  })

  test('a temporary outage is announced but asking stays possible', async ({ page }) => {
    await open(page, { status: { enabled: false, reason: 'provider-unavailable' } })
    await entry(page).click()
    await expect(panel(page).locator('.ai-banner')).toHaveText('EduOS AI is temporarily unavailable. Please try again later.')
    await expect(input(page)).toBeEnabled()
  })

  test('keeps a question within the limit and says how much room is left', async ({ page }) => {
    const asked = await open(page)
    await entry(page).click()
    await input(page).fill('q'.repeat(799))
    await expect(panel(page).locator('.ai-help')).toContainText('Enter to send')
    await input(page).fill('q'.repeat(950))
    await expect(panel(page).locator('.ai-help')).toHaveText('50 characters left')
    // The box takes no more than the backend accepts.
    await input(page).fill('q'.repeat(1200))
    await expect(input(page)).toHaveValue('q'.repeat(1000))
    await expect(panel(page).locator('.ai-help')).toHaveText('Limit reached (1000 characters)')
    await send(page).click()
    await expect(panel(page).locator('.from-assistant.answer')).toHaveCount(1)
    expect((asked[0].body.question as string).length).toBe(1000)
  })

  test('shows that it is working and sends a question only once', async ({ page }) => {
    let release = () => {}
    const waiting = new Promise<void>(resolve => { release = resolve })
    const asked = await open(page, { reply: async () => { await waiting; return { data: answered } } })
    await entry(page).click()
    await input(page).fill('What attendance is required?')
    await input(page).press('Enter')
    await expect(panel(page).locator('.thinking')).toContainText('Working on your question')
    await expect(send(page)).toBeDisabled()
    // More presses and another question while it is working change nothing.
    await input(page).fill('Another question?')
    await input(page).press('Enter')
    await input(page).press('Enter')
    await expect(send(page)).toBeDisabled()
    expect(asked).toHaveLength(1)
    await expect(panel(page).locator('.from-user')).toHaveCount(1)
    release()
    await expect(panel(page).locator('.from-assistant.answer')).toHaveCount(1)
    await expect(panel(page).locator('.thinking')).toHaveCount(0)
    await expect(input(page)).toHaveValue('Another question?')
    await expect(send(page)).toBeEnabled()
    expect(asked).toHaveLength(1)
  })

  test('renders an answer and its sources as plain text, never as markup or links', async ({ page }) => {
    const hostile = 'Fees are due. <img src=x onerror="window.__xss=1"><script>window.__xss=2</script> <a href="javascript:window.__xss=3">click</a> [pay here](https://evil.example/pay) https://evil.example'
    await open(page, { reply: () => ({ data: { ...answered, answer: hostile, sources: [{ number: 1, title: '<b onmouseover="window.__xss=4">Policy</b>', source: '<script>window.__xss=5</script>.md', section: '<i>Fees</i>', page: 2 }] } }) })
    await entry(page).click()
    await ask(page, '<u>When</u> are fees due?')
    const answer = panel(page).locator('.from-assistant.answer')
    await expect(answer.locator('p')).toHaveText(hostile)
    await expect(panel(page).locator('.from-user p')).toHaveText('<u>When</u> are fees due?')
    await expect(answer.locator('.ai-sources strong')).toHaveText('<b onmouseover="window.__xss=4">Policy</b>')
    // Nothing the model or a document wrote became an element.
    await expect(panel(page).locator('.ai-log').locator('img, script, a, b, i, u, iframe')).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
  })

  test('keeps the conversation for this session only and sends each question on its own', async ({ page }) => {
    const asked = await open(page, { reply: (_, count) => ({ data: { ...answered, answer: count === 1 ? 'Seventy-five percent, zebra-quartz.' : 'In December.' } }) })
    await entry(page).click()
    await ask(page, 'What attendance is required, ibis-harbour?')
    await expect(panel(page).locator('.from-assistant.answer')).toHaveCount(1)
    await ask(page, 'And when is sports day?')
    await expect(panel(page).locator('.from-assistant.answer')).toHaveCount(2)
    // The second request carries the second question and nothing of the first exchange.
    expect(asked.map(a => a.body)).toEqual([{ question: 'What attendance is required, ibis-harbour?' }, { question: 'And when is sports day?' }])
    expect(JSON.stringify(asked[1])).not.toMatch(/ibis-harbour|zebra-quartz|history|messages|school|audience|role|document|tenant/i)
    // Closing and reopening keeps what is on screen; moving to another page does too.
    await panel(page).getByRole('button', { name: 'Close EduOS AI' }).click()
    await page.getByRole('link', { name: /Go to my/ }).click()
    await entry(page).click()
    await expect(panel(page).locator('.ai-message')).toHaveCount(4)
    // Nothing of the conversation is written to browser storage.
    const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]))
    expect(stored).not.toMatch(/ibis-harbour|zebra-quartz|sports day|December/)
    // "Start a new conversation" clears it, and so does a refresh.
    await ask(page, 'One more?')
    await expect(panel(page).locator('.ai-message')).toHaveCount(6)
    await panel(page).getByRole('button', { name: 'Start a new conversation' }).click()
    await expect(panel(page).locator('.ai-message')).toHaveCount(0)
    await ask(page, 'After clearing?')
    await expect(panel(page).locator('.ai-message')).toHaveCount(2)
    await page.reload()
    await entry(page).click()
    await expect(panel(page).locator('.ai-message')).toHaveCount(0)
    await expect(panel(page)).toContainText('How can I help?')
  })

  test('the panel has no WCAG A or AA violations, empty or in conversation', async ({ page }) => {
    await open(page, { reply: (_, count) => ({ data: count === 1 ? answered : { available: false, reason: 'insufficient-knowledge' } }) })
    await entry(page).click()
    const scan = async () => (await new AxeBuilder({ page }).include('dialog.ai-panel').withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))
    expect(await scan()).toEqual([])
    await ask(page, 'What attendance is required?')
    await ask(page, 'What time does the pool open?')
    await expect(panel(page).locator('.from-assistant.notice')).toHaveCount(1)
    await input(page).fill('q'.repeat(990))
    expect(await scan()).toEqual([])
  })

  test('works at phone width: the panel fills the screen and stays usable', async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 720 })
    await open(page)
    await expect(entry(page)).toBeVisible()
    // A compact round button in the corner; its name stays for assistive technology.
    const button = (await entry(page).boundingBox())!
    expect([Math.round(button.width), Math.round(button.height), Math.round(380 - button.x - button.width), Math.round(720 - button.y - button.height)]).toEqual([52, 52, 16, 16])
    await expect(entry(page).locator('span')).toBeHidden()
    await entry(page).click()
    const box = await panel(page).boundingBox()
    expect(box && Math.round(box.width)).toBe(380)
    expect(box && Math.round(box.height)).toBe(720)
    await ask(page, 'What attendance is required?')
    await expect(panel(page).locator('.from-assistant.answer')).toBeVisible()
    await expect(input(page)).toBeInViewport()
    await expect(send(page)).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
