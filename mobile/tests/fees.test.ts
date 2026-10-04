import test from 'node:test'
import assert from 'node:assert/strict'
import { STATE_LABEL, dueCharges, ledgerNote, money, stateTone, type LedgerCharge, type LedgerTotals } from '../src/features/logic.ts'
import { canOpen, navigationFor } from '../src/access/experience.ts'
import { resolveNotificationRoute } from '../src/notifications/routes.ts'
import type { User } from '../src/session/types.ts'

const person = (dataScope: string, permissions: string[]): User => ({ id: 'u', username: 'u', email: '', firstName: '', lastName: '', schoolId: 's', roles: [], permissions, dataScope })
const charge = (over: Partial<LedgerCharge>): LedgerCharge => ({ id: 'c', description: 'Tuition · Term 1', dueDate: '2026-10-15', net: 14000, paid: 0, outstanding: 14000, state: 'Unpaid', overdue: false, currency: 'INR', ...over })

test('fees open for parents, students and leadership with fees.view, and for nobody without it; teachers have no entry', () => {
  for (const scope of ['parent', 'student', 'school']) assert.ok(canOpen(person(scope, ['fees.view']), '/fees'), scope)
  for (const scope of ['parent', 'student', 'school', 'teacher']) assert.ok(!canOpen(person(scope, ['reports.view']), '/fees'), scope + ' without the permission')
  assert.ok(!navigationFor(person('teacher', ['fees.view', 'classes.view'])).some(e => e.route === '/fees'), 'a teacher has no fees entry even with the permission')
})

test('the ledger lays out what is due: overdue first, settled and waived left out; labels and tones for every state', () => {
  const rows = [charge({ id: 'a', dueDate: '2026-11-01' }), charge({ id: 'b', dueDate: '2026-09-01', overdue: true, state: 'Overdue' }), charge({ id: 'c', paid: 14000, outstanding: 0, state: 'Paid' }), charge({ id: 'd', state: 'Waived', outstanding: 0 }), charge({ id: 'e', dueDate: '2026-10-20', paid: 4000, outstanding: 10000, state: 'Partial' })]
  assert.deepEqual(dueCharges(rows).map(c => c.id), ['b', 'e', 'a'])
  for (const s of Object.keys(STATE_LABEL) as (keyof typeof STATE_LABEL)[]) assert.ok(STATE_LABEL[s])
  assert.equal(stateTone('Paid'), 'success'); assert.equal(stateTone('Overdue'), 'danger'); assert.equal(stateTone('Partial'), 'warning'); assert.equal(stateTone('Cancelled'), 'neutral')
  const t: LedgerTotals = { charges: 2, applicable: 18000, concessions: 1000, net: 17000, paid: 5000, outstanding: 12000, overdue: 9000, overdueCount: 1, currency: 'INR' }
  assert.equal(ledgerNote(t), '1 overdue of 2 charges'); assert.equal(ledgerNote({ ...t, outstanding: 0 }), 'All charges settled'); assert.equal(ledgerNote({ ...t, charges: 0 }), 'No fees charged yet')
  assert.equal(money('INR', 12000), 'INR 12,000.00')
})

test('fee notifications open Fees for the family', () => {
  for (const type of ['fee.due', 'fee.payment_received', 'fee.due_soon', 'fee.overdue'] as const) assert.equal(resolveNotificationRoute({ type }, person('parent', ['fees.view'])).route, '/fees')
})
