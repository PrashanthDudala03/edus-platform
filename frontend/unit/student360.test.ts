// Run with `npm run test:unit`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { TAB_LABEL, attendanceNote, byDay, examsNote, feesNote, homeworkNote, initials, isTab, kindTone, money, pct, resultLabel, tabsFor, type Exams, type Fees, type Homework } from '../src/pages/suite/student360.ts'

test('fees get a tab only for roles that may see them, and every tab has a label', () => {
  assert.deepEqual(tabsFor({ fees: true }), ['overview', 'academics', 'attendance', 'homework', 'exams', 'fees', 'documents', 'timeline'])
  assert.ok(!tabsFor({ fees: false }).includes('fees'))
  for (const t of tabsFor({ fees: true })) assert.ok(TAB_LABEL[t])
  assert.ok(isTab('homework', { fees: false })); assert.ok(!isTab('fees', { fees: false })); assert.ok(!isTab('x', { fees: true })); assert.ok(!isTab(null, { fees: true }))
})

test('unavailable data reads as a dash, never a fake zero', () => {
  assert.equal(pct(null), '—'); assert.equal(pct(0), '0%'); assert.equal(pct(87), '87%')
  assert.equal(attendanceNote({ present: 0, late: 0, absent: 0, excused: 0, markedDays: 0, percent: null }), 'No days marked yet')
  assert.equal(attendanceNote({ present: 18, late: 2, absent: 1, excused: 0, markedDays: 21, percent: 95 }), '20 of 21 days attended')
  const h: Homework = { assigned: 0, counts: {}, completion: null, due: [], feedback: [] }
  assert.equal(homeworkNote(h), 'No homework set yet'); assert.equal(homeworkNote({ ...h, assigned: 4, counts: { missing: 1, 'due-today': 1, upcoming: 2 } }), '1 missing · 3 due')
  const e: Exams = { upcoming: [], published: 0, obtained: 0, maximum: 0, percent: 0, grade: 'Not available', passed: 0, failed: 0, latest: [] }
  assert.equal(examsNote(e), 'No published results yet'); assert.equal(examsNote({ ...e, published: 3, passed: 2, failed: 1 }), '2 passed · 1 below pass marks')
  const f: Fees = { available: true, charges: 2, applicable: 12000, paid: 7000, outstanding: 5000, overdue: 1, currency: 'INR', recentPayments: [] }
  assert.equal(feesNote(f), '1 overdue of 2 charges'); assert.equal(feesNote({ ...f, outstanding: 0 }), 'All charges settled'); assert.equal(feesNote({ ...f, charges: 0 }), 'No fees charged yet')
  assert.equal(feesNote({ available: false, reason: 'Fee details are shown to the school office and the family.' }), 'Fee details are shown to the school office and the family.')
  assert.equal(money('INR', 12500.5), 'INR 12,500.5'); assert.equal(money('', 10), '10')
})

test('the timeline groups by day and every kind has a tone; results read with absent and exempt', () => {
  const at = (iso: string) => ({ at: iso, kind: 'homework', title: 't', detail: '', source: 'homework', entityId: '' })
  assert.deepEqual(byDay([at('2026-10-05T09:00:00Z'), at('2026-10-05T07:00:00Z'), at('2026-10-04T10:00:00Z')]).map(d => [d.day, d.events.length]), [['2026-10-05', 2], ['2026-10-04', 1]])
  for (const k of ['attendance', 'homework', 'exam', 'result', 'fee', 'payment', 'document']) assert.ok(kindTone(k))
  assert.equal(initials('Aarav Sharma'), 'AS'); assert.equal(initials('aarav'), 'A'); assert.equal(initials(''), '?')
  const r = { exam: 'Half-yearly', term: '', subject: 'Science', status: 'Present', score: 81, maximum: 100, grade: 'B', pass: true, components: [] }
  assert.equal(resultLabel(r), '81 / 100 · B'); assert.equal(resultLabel({ ...r, status: 'Absent' }), 'Absent'); assert.equal(resultLabel({ ...r, maximum: null, score: null, grade: 'A+' }), 'A+')
})
