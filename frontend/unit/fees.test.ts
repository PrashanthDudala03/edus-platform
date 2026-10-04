// Run with `npm run test:unit`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { METHODS, STATE_LABEL, checkoutAllowed, checkoutOptions, concessionLabel, feesNote, methodBreakdown, money, needsReference, payable, paymentProblem, stateTone, upcoming, type Charge, type Checkout, type Concession, type Totals } from '../src/pages/suite/fees.ts'

test('a browser checkout opens only for a test-mode order the server fixed, and carries nothing but the public key', () => {
  const c: Checkout = { keyId: 'rzp_test_abc', orderId: 'order_77', amount: 900000, currency: 'INR', name: 'EduOS Demo School', description: 'Tuition · Term 1', mode: 'Test' }
  assert.ok(checkoutAllowed(c))
  assert.ok(!checkoutAllowed({ ...c, mode: 'Live' })); assert.ok(!checkoutAllowed({ ...c, keyId: 'rzp_live_abc' })); assert.ok(!checkoutAllowed({ ...c, orderId: 'fake_1' })); assert.ok(!checkoutAllowed({ ...c, amount: 0 })); assert.ok(!checkoutAllowed(null)); assert.ok(!checkoutAllowed(undefined))
  const handler = () => {}, dismiss = () => {}, o = checkoutOptions(c, handler, dismiss)
  assert.equal(o.key, 'rzp_test_abc'); assert.equal(o.order_id, 'order_77'); assert.equal(o.amount, 900000); assert.equal(o.currency, 'INR'); assert.equal(o.description, 'TEST MODE · Tuition · Term 1'); assert.equal(o.handler, handler); assert.equal(o.modal.ondismiss, dismiss); assert.equal(o.retry.enabled, false)
  assert.ok(!JSON.stringify(o).toLowerCase().includes('secret'))
})

const charge = (over: Partial<Charge>): Charge => ({ id: 'c', studentId: 's', student: 'Aarav', class: 'Grade 6 - A', description: 'Tuition · Term 1', structureId: 'f', dueDate: '2026-10-15', gross: 15000, concession: 1000, issueConcession: 1000, laterConcession: 0, fine: 0, net: 14000, paid: 0, balance: 14000, outstanding: 14000, status: 'Active', state: 'Unpaid', overdue: false, currency: 'INR', note: '', ...over })

test('every state has a label and a tone; money reads in rupees with two decimals, never a float surprise', () => {
  for (const s of Object.keys(STATE_LABEL) as (keyof typeof STATE_LABEL)[]) assert.ok(STATE_LABEL[s])
  assert.equal(stateTone('Paid'), 'active'); assert.equal(stateTone('Overdue'), 'important'); assert.equal(stateTone('Partial'), '')
  assert.equal(money('INR', 14000), 'INR 14,000.00'); assert.equal(money('INR', 900.05), 'INR 900.05'); assert.equal(money('', 10), '10.00'); assert.equal(money('INR', null), '—')
  assert.deepEqual([...METHODS], ['Cash', 'UPI', 'Bank transfer', 'Cheque', 'Other'])
})

test('a payment is checked before it is sent: within the balance, a valid method, a reference where one is needed', () => {
  assert.equal(paymentProblem('5000', 14000, 'Cash', ''), null)
  assert.equal(paymentProblem('14000', 14000, 'UPI', 'UPI-1'), null)
  assert.equal(paymentProblem('14000.01', 14000, 'Cash', ''), 'Payment exceeds the outstanding balance.')
  assert.equal(paymentProblem('900.05', 900.05, 'Cash', ''), null)                      // compared in paise, not floats
  assert.equal(paymentProblem('', 14000, 'Cash', ''), 'Enter the amount received.')
  assert.equal(paymentProblem('0', 14000, 'Cash', ''), 'Enter the amount received.')
  assert.equal(paymentProblem('100', 14000, 'Card', ''), 'Choose a payment method.')
  assert.equal(paymentProblem('100', 14000, 'Cheque', ''), 'A bank / UPI / cheque reference is required.')
  assert.ok(needsReference('UPI') && needsReference('Bank transfer') && needsReference('Cheque') && !needsReference('Cash') && !needsReference('Other'))
})

test('payable charges put overdue first then soonest due; upcoming leaves overdue out; settled and waived are not payable', () => {
  const rows = [charge({ id: 'a', dueDate: '2026-11-01' }), charge({ id: 'b', dueDate: '2026-09-01', overdue: true, state: 'Overdue' }), charge({ id: 'c', paid: 14000, outstanding: 0, state: 'Paid' }), charge({ id: 'd', status: 'Waived', state: 'Waived', outstanding: 0 }), charge({ id: 'e', dueDate: '2026-10-20' })]
  assert.deepEqual(payable(rows).map(c => c.id), ['b', 'e', 'a'])
  assert.deepEqual(upcoming(rows).map(c => c.id), ['e', 'a'])
})

test('notes and labels read naturally and never invent a figure', () => {
  const t: Totals = { charges: 0, applicable: 0, concessions: 0, fines: 0, net: 0, paid: 0, outstanding: 0, overdue: 0, overdueCount: 0, waived: 0, currency: 'INR' }
  assert.equal(feesNote(t), 'No fees charged yet'); assert.equal(feesNote({ ...t, charges: 3, outstanding: 5000, overdueCount: 1 }), '1 overdue of 3 charges'); assert.equal(feesNote({ ...t, charges: 3 }), 'All charges settled')
  const k: Concession = { id: 'k', chargeId: null, kind: 'Percent', value: 25, reason: 'Sibling', from: '2026-04-01', to: null, status: 'Active', createdAt: '' }
  assert.equal(concessionLabel(k), '25% on every charge (2026-04-01 to …)'); assert.equal(concessionLabel({ ...k, kind: 'Fixed', value: 2000, chargeId: 'c', from: null }), 'Fixed 2,000 on one charge')
  assert.equal(methodBreakdown({ Cash: 4000, UPI: 2500 }, 'INR'), 'Cash INR 4,000.00 · UPI INR 2,500.00')
})
