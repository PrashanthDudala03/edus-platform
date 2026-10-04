import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leaveDays, fmtDays, range, statusTone, canCancel, balanceNote, defaultType, impactWord, byMonth, type Balance, type Leave } from '../src/pages/suite/leave.ts'

const balance = (extra: Partial<Balance>): Balance => ({ typeId: 't1', name: 'Casual leave', code: 'CL', paid: 'Paid', tracksBalance: true, active: true, year: '2026-27', allowance: 12, added: 0, deducted: 0, used: 3, pending: 1, remaining: 9, afterPending: 8, ...extra })

test('days are inclusive and a half day is half of one', () => {
  assert.equal(leaveDays('2026-10-05', '2026-10-07'), 3); assert.equal(leaveDays('2026-10-05', '2026-10-05'), 1); assert.equal(leaveDays('2026-10-05', '2026-10-05', 'First half'), 0.5)
  assert.equal(leaveDays('2026-10-07', '2026-10-05'), 0); assert.equal(leaveDays('', '2026-10-05'), 0)
  assert.equal(fmtDays(3), '3'); assert.equal(fmtDays(0.5), '0.5'); assert.equal(fmtDays(null), '—')
  assert.equal(range('2026-10-05', '2026-10-05', 'Second half'), '2026-10-05 · second half'); assert.equal(range('2026-10-05', '2026-10-07'), '2026-10-05 to 2026-10-07')
})

test('who may withdraw or cancel, and how a status looks', () => {
  assert.equal(canCancel('Pending', true, false), true); assert.equal(canCancel('Pending', false, false), false); assert.equal(canCancel('Pending', false, true), true)
  assert.equal(canCancel('Approved', true, false), false); assert.equal(canCancel('Approved', false, true), true); assert.equal(canCancel('Rejected', true, true), false)
  assert.equal(statusTone('Approved'), 'active'); assert.equal(statusTone('Rejected'), 'important'); assert.equal(statusTone('Cancelled'), 'muted'); assert.equal(statusTone('Pending'), '')
})

test('balances are worded from the server figures and the default type is one with days left', () => {
  assert.equal(balanceNote(balance({})), '9 of 12 days left · 1 pending'); assert.equal(balanceNote(balance({ tracksBalance: false, remaining: null })), 'Not tracked')
  assert.equal(balanceNote(balance({ added: 2, deducted: 1, pending: 0, remaining: 10 })), '10 of 13 days left')
  const exhausted = balance({ typeId: 'cl', afterPending: 0 }), sick = balance({ typeId: 'sl', name: 'Sick leave', afterPending: 4 }), unpaid = balance({ typeId: 'ul', name: 'Unpaid', tracksBalance: false, remaining: null, afterPending: null })
  assert.equal(defaultType([exhausted, sick, unpaid]), 'sl'); assert.equal(defaultType([exhausted]), 'cl'); assert.equal(defaultType([unpaid]), 'ul'); assert.equal(defaultType([balance({ active: false })]), ''); assert.equal(defaultType([]), '')
})

test('impact is worded for the approver and requests group by month, newest first', () => {
  assert.equal(impactWord({ affected: 0, covered: 0, uncovered: 0 }), 'No lessons affected'); assert.equal(impactWord({ affected: 3, covered: 3, uncovered: 0 }), '3 lessons, all covered')
  assert.equal(impactWord({ affected: 1, covered: 1, uncovered: 0 }), '1 lesson, all covered'); assert.equal(impactWord({ affected: 4, covered: 1, uncovered: 3 }), '3 of 4 lessons still need cover')
  const leave = (id: string, fromDate: string): Leave => ({ id, version: 1, teacherId: 'T1', typeId: '', fromDate, toDate: fromDate, halfDay: 'No', reason: '', status: 'Pending', approvalRemark: '' })
  assert.deepEqual(byMonth([leave('a', '2026-09-10'), leave('b', '2026-10-02'), leave('c', '2026-10-20')]).map(([m, rows]) => [m, rows.map(r => r.id)]), [['2026-10', ['b', 'c']], ['2026-09', ['a']]])
})
