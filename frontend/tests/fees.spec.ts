import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

// Fees & collections in a real browser with the API mocked: the accountant finds a student, records a payment and
// gets the receipt in a few steps, reverses one with a reason, reads the outstanding report; a parent sees one child
// with no payment controls; the phone layout has no sideways scrolling. No service, database or money is involved.
const dist = resolve(process.cwd(), 'dist')
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }
const school = '11111111-1111-4111-8111-111111111111'
const admin = { id: '22222222-2222-4222-8222-222222222222', username: 'admin', email: 'a@example.test', firstName: 'Asha', lastName: 'Rao', schoolId: school, roles: ['Administrator'], dataScope: 'school', permissions: ['fees.view', 'fees.collect', 'fees.manage', 'fee-structures.view', 'fee-structures.manage', 'reports.view', 'overview.view'] }
const principal = { ...admin, id: '33333333-3333-4333-8333-333333333333', username: 'principal', roles: ['Principal'], permissions: ['fees.view', 'reports.view', 'overview.view'] }
const parent = { ...admin, id: '55555555-5555-4555-8555-555555555555', username: 'neha', firstName: 'Neha', lastName: 'Sharma', roles: ['Parent'], dataScope: 'parent', permissions: ['fees.view', 'reports.view'] }
const S1 = 'aaaaaaaa-0000-4000-8000-000000000001', C1 = 'cccccccc-0000-4000-8000-000000000001', C2 = 'cccccccc-0000-4000-8000-000000000002', P1 = 'pppppppp-0000-4000-8000-000000000001'
type Call = { method: string, path: string, body: Record<string, unknown> | null }

async function mock(page: Page, user = admin) {
  const calls: Call[] = []; let paid = 0, reversed = false, receipt = 'RCPT-2026-000007'
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(([stored]) => { localStorage.setItem('accessToken', 'test-access-token'); localStorage.setItem('refreshToken', 'test-refresh-token'); localStorage.setItem('user', stored); localStorage.setItem('eduos.skipSchoolHome', '1') }, [JSON.stringify(user)])
  const json = (route: Route, body: unknown, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) })
  const charges = () => [
    { id: C1, studentId: S1, student: 'Aarav Sharma', class: 'Grade 6 - A', description: 'Tuition · Term 1', structureId: 'f1', dueDate: '2026-09-15', gross: 15000, concession: 1000, issueConcession: 1000, laterConcession: 0, fine: 0, net: 14000, paid: 5000 + (reversed ? 0 : paid), balance: 9000 - (reversed ? 0 : paid), outstanding: 9000 - (reversed ? 0 : paid), status: 'Active', state: 9000 - paid <= 0 ? 'Paid' : 'Overdue', overdue: 9000 - paid > 0, currency: 'INR', note: '' },
    { id: C2, studentId: S1, student: 'Aarav Sharma', class: 'Grade 6 - A', description: 'Transport · Term 1', structureId: 'f2', dueDate: '2026-11-15', gross: 3000, concession: 0, issueConcession: 0, laterConcession: 0, fine: 0, net: 3000, paid: 0, balance: 3000, outstanding: 3000, status: 'Active', state: 'Unpaid', overdue: false, currency: 'INR', note: '' }]
  const totals = () => { const outstanding = 12000 - (reversed ? 0 : paid); return { charges: 2, applicable: 18000, concessions: 1000, fines: 0, net: 17000, paid: 5000 + (reversed ? 0 : paid), outstanding, overdue: Math.max(0, 9000 - (reversed ? 0 : paid)), overdueCount: 9000 - (reversed ? 0 : paid) > 0 ? 1 : 0, waived: 0, currency: 'INR' } }
  const payments = () => [...(paid ? [{ id: P1, receipt, amount: paid, method: 'UPI', reference: 'UPI-77', status: reversed ? 'Reversed' : 'Completed', source: 'manual', note: '', paidOn: '2026-10-05', createdAt: '2026-10-05T09:00:00Z', reversalReason: reversed ? 'Entered against the wrong student' : null, reversedAt: null, description: 'Tuition · Term 1', currency: 'INR', student: 'Aarav Sharma', class: 'Grade 6 - A', collectedBy: 'Asha Rao' }] : []), { id: 'p0', receipt: 'RCPT-2026-000003', amount: 5000, method: 'Cash', reference: '', status: 'Completed', source: 'manual', note: '', paidOn: '2026-09-01', createdAt: '2026-09-01T09:00:00Z', reversalReason: null, reversedAt: null, description: 'Tuition · Term 1', currency: 'INR', student: 'Aarav Sharma', class: 'Grade 6 - A', collectedBy: 'Asha Rao' }]
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.startsWith('/api/') ? url.pathname.replace('/api/v1', '') : '', method = request.method()
    if (path && method !== 'GET') calls.push({ method, path, body: request.postData() ? request.postDataJSON() : null })
    if (path === '/control/me') return json(route, { data: user })
    if (path === '/suite/options') return json(route, { data: { students: [{ id: S1, label: 'Aarav Sharma' }, { id: 'st2', label: 'Diya Sharma' }], classes: [], 'fee-structures': [] } })
    if (path === '/suite/fees/summary') return json(route, { data: { collectedToday: paid && !reversed ? paid : 0, collectedThisMonth: 5000 + (reversed ? 0 : paid), reversalsThisMonth: reversed ? 1 : 0, totals: totals(), byClass: [{ class: 'Grade 6 - A', outstanding: totals().outstanding, overdue: totals().overdue, paid: 5000 }], recent: payments(), online: { provider: 'none', merchantReference: '', connectionStatus: 'NotConnected', onlineEnabled: false, settlementStatus: 'NotReady', providers: ['none', 'fake', 'razorpay'], note: '' } } })
    if (path === '/suite/fees/ledger/' + S1) return json(route, { data: { student: { id: S1, name: 'Aarav Sharma', admissionNumber: 'S1', class: 'Grade 6 - A' }, totals: totals(), charges: charges(), payments: { items: payments(), total: payments().length, page: 1, pageSize: 20, more: false }, concessions: [{ id: 'k1', chargeId: null, kind: 'Percent', value: 10, reason: 'Sibling discount', from: null, to: null, status: 'Active', createdAt: '' }], online: { enabled: user.roles[0] === 'Parent', provider: 'fake' } } })
    if (path === '/suite/fees/payments' && method === 'POST') { const body = request.postDataJSON() as { amount: number }; paid = body.amount; return json(route, { data: { id: P1, receipt } }, 201) }
    if (path === '/suite/fees/payments/' + P1 + '/reverse') { reversed = true; return json(route, { data: { id: P1, status: 'Reversed' } }) }
    if (path.startsWith('/suite/fees/receipts/')) return json(route, { data: { receipt: { receipt, student: 'Aarav Sharma', admissionNumber: 'S1', class: 'Grade 6 - A', academicYear: '2026-27', feeHead: 'Tuition', description: 'Tuition · Term 1', paidOn: '2026-10-05', amount: paid, method: 'UPI', reference: 'UPI-77', status: reversed ? 'Reversed' : 'Completed', source: 'manual', collectedBy: 'Asha Rao', currency: 'INR' }, school: { name: 'Green Valley School', principal: 'Asha Rao' } } })
    if (path === '/suite/fees/history') return json(route, { data: { items: payments(), total: payments().length, page: 1, pageSize: 25, more: false } })
    if (path === '/suite/fees/reports/outstanding') return json(route, { data: { items: [{ studentId: S1, student: 'Aarav Sharma', class: 'Grade 6 - A', applicable: 17000, paid: 5000 + (reversed ? 0 : paid), outstanding: totals().outstanding, overdue: totals().overdue, charges: 2, currency: 'INR' }], total: 1, page: 1, pageSize: 50, more: false, outstanding: totals().outstanding, overdue: totals().overdue } })
    if (path === '/suite/fees/reports/daily') return json(route, { data: { day: '2026-10-05', total: paid && !reversed ? paid : 0, count: paid && !reversed ? 1 : 0, reversed: reversed ? 1 : 0, byMethod: paid && !reversed ? { UPI: paid } : {}, transactions: payments().filter(p => p.paidOn === '2026-10-05'), currency: 'INR' } })
    if (path === '/suite/fees/reports/classes') return json(route, { data: [{ class: 'Grade 6 - A', students: 1, applicable: 17000, paid: 5000, outstanding: totals().outstanding, overdue: totals().overdue, currency: 'INR' }] })
    if (path === '/suite/fees/online/intents' && method === 'POST') return json(route, { data: { id: 'i1', status: 'Pending', provider: 'fake', orderReference: 'fake_i1', amount: 9000, currency: 'INR', instructions: 'Test provider: confirm the payment by posting a signed event to the fees webhook.' } }, 201)
    if (path === '/suite/fees/payment-config') return json(route, { data: { provider: 'none', merchantReference: '', connectionStatus: 'NotConnected', onlineEnabled: false, settlementStatus: 'NotReady', providers: ['none', 'fake', 'razorpay'], note: 'Credentials are never stored here.' } })
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
const axe = async (page: Page) => (await new AxeBuilder({ page }).include('#main').analyze()).violations.flatMap(v => v.nodes.map(n => v.id + ' ' + n.target.join(' ')))

test.describe('Fees & collections', () => {
  test('the accountant finds a student, records a payment, gets the receipt, and reverses it with a reason', async ({ page, context }) => {
    const calls = await mock(page)
    await page.goto('/suite/fees')
    await expect(page.getByRole('heading', { name: 'Fees & collections' })).toBeVisible()
    await expect(main(page).locator('.stat-card').nth(2)).toContainText('INR 12,000.00')                 // outstanding from the server, not summed here
    await page.getByLabel('Find a student').fill('Aar')
    await main(page).getByRole('button', { name: 'Open ledger' }).click()
    await expect(main(page)).toContainText('Admission S1 · Grade 6 - A')
    await expect(main(page).getByRole('row', { name: /Tuition · Term 1 · concession/ })).toContainText('Overdue')
    await expect(main(page)).toContainText('10% on every charge · Sibling discount')
    await main(page).getByRole('button', { name: 'Record payment' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('Amount received')).toHaveValue('9000')                             // the overdue instalment first, its balance filled in
    await dialog.getByLabel('Amount received').fill('9000.01')
    await expect(dialog.getByRole('button', { name: 'Record and print receipt' })).toBeDisabled()
    await dialog.getByLabel('Amount received').fill('4000')
    await dialog.getByLabel('Method').selectOption('UPI')
    await expect(dialog.getByRole('button', { name: 'Record and print receipt' })).toBeDisabled()       // UPI needs a reference
    await dialog.getByLabel('Reference', { exact: true }).fill('UPI-77')
    const popup = context.waitForEvent('page')
    await dialog.getByRole('button', { name: 'Record and print receipt' }).click()
    await expect(main(page).getByText('Payment recorded. Receipt RCPT-2026-000007.')).toBeVisible()
    const receipt = await popup; await expect(receipt.locator('body')).toContainText('RCPT-2026-000007'); await expect(receipt.locator('body')).toContainText('Received by'); await receipt.close()
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/suite/fees/payments', body: { chargeId: C1, amount: 4000, method: 'UPI', reference: 'UPI-77' } })
    expect(typeof (calls[0].body as { idempotencyKey: string }).idempotencyKey).toBe('string')
    await expect(main(page).getByRole('row', { name: /RCPT-2026-000007/ })).toContainText('Completed')
    await main(page).getByRole('row', { name: /RCPT-2026-000007/ }).getByRole('button', { name: 'Reverse' }).click()
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Reverse this payment' })).toBeDisabled()
    await page.getByRole('dialog').getByLabel('Reason').fill('Entered against the wrong student')
    await page.getByRole('dialog').getByRole('button', { name: 'Reverse this payment' }).click()
    await expect(main(page).getByText('Payment RCPT-2026-000007 reversed.')).toBeVisible()
    expect(calls.at(-1)).toMatchObject({ method: 'POST', path: '/suite/fees/payments/' + P1 + '/reverse', body: { reason: 'Entered against the wrong student' } })
    await expect(main(page).getByRole('row', { name: /RCPT-2026-000007/ })).toContainText('Reversed')     // the receipt stays on record
    expect(await axe(page)).toEqual([])
  })

  test('the outstanding and daily reports read the server totals', async ({ page }) => {
    await mock(page)
    await page.goto('/suite/fees')
    await main(page).getByRole('link', { name: 'Outstanding' }).click()
    await expect(main(page).getByRole('row', { name: /Aarav Sharma/ })).toContainText('INR 12,000.00')
    await main(page).getByRole('link', { name: 'Dues by class' }).click()
    await expect(main(page).getByRole('row', { name: /Grade 6 - A/ })).toContainText('INR 12,000.00')
    await main(page).getByRole('link', { name: 'Daily collection' }).click()
    await expect(main(page)).toContainText('No payments on this day')
    expect(await axe(page)).toEqual([])
  })

  test('the principal reads the ledger and reports but cannot collect, concede or reverse', async ({ page }) => {
    await mock(page, principal)
    await page.goto('/suite/fees')
    await page.getByLabel('Find a student').fill('Aar')
    await main(page).getByRole('button', { name: 'Open ledger' }).click()
    await expect(main(page)).toContainText('Admission S1')
    await expect(main(page).getByRole('button', { name: /Record payment|Collect|Give concession|Reverse|Waive/ })).toHaveCount(0)
    await expect(main(page).getByRole('link', { name: 'Online payments' })).toHaveCount(0)
  })

  test('a parent sees one child, the receipts, and an online option only because the school switched it on', async ({ page }) => {
    const calls = await mock(page, parent)
    await page.goto('/suite/fees')
    await expect(page.getByLabel('Choose child')).toHaveValue(S1)
    await expect(main(page)).toContainText('Tuition · Term 1')
    await expect(main(page).getByRole('button', { name: /Record payment|Collect|Give concession|Reverse/ })).toHaveCount(0)
    await main(page).getByRole('button', { name: 'Pay online' }).click()
    await expect(page.getByRole('dialog')).toContainText('fake_i1')
    await expect(page.getByRole('dialog')).toContainText('pending')
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/suite/fees/online/intents', body: { chargeId: C1 } })
  })

  test('with Razorpay in test mode a parent pays through the checkout and the server, not the browser, confirms it', async ({ page }) => {
    const calls = await mock(page, parent)
    // The checkout script is Razorpay's; here a stand-in reports a result, or a dismissal, exactly as the real one would.
    await page.addInitScript(() => { (window as unknown as { Razorpay: unknown }).Razorpay = function (this: { open: () => void }, options: { order_id: string, key: string, amount: number, handler: (r: Record<string, string>) => void, modal: { ondismiss: () => void } }) {
      this.open = () => { if (options.amount === 900000 && options.key === 'rzp_test_abc' && !(window as unknown as { dismissNext?: boolean }).dismissNext) options.handler({ razorpay_order_id: options.order_id, razorpay_payment_id: 'pay_test_9', razorpay_signature: 'sig' }); else options.modal.ondismiss() } } })
    const confirms: Record<string, string>[] = []
    await page.route('**/api/v1/suite/fees/online/intents', route => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'i1', status: 'Pending', provider: 'razorpay', orderReference: 'order_77', amount: 9000, currency: 'INR', checkout: { keyId: 'rzp_test_abc', orderId: 'order_77', amount: 900000, currency: 'INR', name: 'EduOS Demo School', description: 'Tuition · Term 1', mode: 'Test' } } }) }))
    await page.route('**/api/v1/suite/fees/online/intents/i1/confirm', route => { const body = route.request().postDataJSON() as Record<string, string>; confirms.push(body); return route.fulfill({ status: body.signature === 'sig' ? 200 : 401, contentType: 'application/json', body: JSON.stringify(body.signature === 'sig' ? { data: { id: 'i1', status: confirms.length === 1 ? 'verified' : 'already-decided', receipt: 'RCPT-2026-000009' } } : { message: 'The payment result could not be verified.' }) }) })
    await page.goto('/suite/fees')
    await main(page).getByRole('button', { name: 'Pay online' }).click()
    await expect(main(page).getByText('Payment verified. Receipt RCPT-2026-000009.')).toBeVisible()
    expect(confirms).toEqual([{ orderId: 'order_77', paymentId: 'pay_test_9', signature: 'sig' }])
    expect(calls.some(c => c.path.includes('/online/intents'))).toBe(false)                             // the stand-in routes answered; nothing reached the mock backend
    // A dismissed checkout changes nothing and says so.
    await page.evaluate(() => { (window as unknown as { dismissNext: boolean }).dismissNext = true })
    await main(page).getByRole('button', { name: 'Pay online' }).click()
    await expect(main(page).getByText('Payment not completed. Nothing was charged and the balance is unchanged.')).toBeVisible()
    expect(confirms.length).toBe(1)
  })

  test('at 390px the ledger fits without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mock(page)
    await page.goto('/suite/fees')
    await page.getByLabel('Find a student').fill('Aar')
    await main(page).getByRole('button', { name: 'Open ledger' }).click()
    await expect(main(page)).toContainText('Admission S1')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
  })
})
