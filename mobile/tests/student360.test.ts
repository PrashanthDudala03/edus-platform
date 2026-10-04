import test from 'node:test'
import assert from 'node:assert/strict'
import { S360_TAB_LABEL, pctLabel, s360AttendanceNote, s360EventIcon, s360EventsByDay, s360ExamsNote, s360FeesNote, s360HomeworkNote, s360Tabs, type Student360 } from '../src/features/logic.ts'
import { canOpen, navigationFor } from '../src/access/experience.ts'
import type { User } from '../src/session/types.ts'

const person = (dataScope: string, permissions: string[]): User => ({ id: 'u', username: 'u', email: '', firstName: '', lastName: '', schoolId: 's', roles: [], permissions, dataScope })

test('every role reaches Student 360 with reports.view, and never without it', () => {
  for (const scope of ['parent', 'student', 'teacher', 'school']) {
    assert.ok(canOpen(person(scope, ['reports.view']), '/student360'), scope)
    assert.ok(!canOpen(person(scope, ['homework.view']), '/student360'), scope + ' without the permission')
  }
  assert.ok(!canOpen(person('platform', ['reports.view']), '/student360'))
  assert.equal(navigationFor(person('student', ['reports.view'])).find(e => e.route === '/student360')?.label, 'My school profile')
  assert.equal(navigationFor(person('teacher', ['reports.view'])).find(e => e.route === '/student360')?.label, 'Students')
  assert.ok(navigationFor(person('parent', ['reports.view'])).some(e => e.route === '/student360' && !e.tab))   // reached from Home and Profile, not a tab
})

test('fees get a section only where the role may see them, and unavailable data is a dash', () => {
  assert.deepEqual(s360Tabs({ fees: true }), ['overview', 'academics', 'attendance', 'homework', 'exams', 'fees', 'documents', 'timeline'])
  assert.ok(!s360Tabs({ fees: false }).includes('fees'))
  for (const t of s360Tabs({ fees: true })) assert.ok(S360_TAB_LABEL[t])
  assert.equal(pctLabel(null), '—'); assert.equal(pctLabel(0), '0%')
  assert.equal(s360AttendanceNote({ present: 0, late: 0, absent: 0, excused: 0, markedDays: 0, percent: null }), 'No days marked yet')
  assert.equal(s360AttendanceNote({ present: 18, late: 2, absent: 1, excused: 0, markedDays: 21, percent: 95 }), '20 of 21 days attended')
  const h: Student360['homework'] = { assigned: 3, counts: { missing: 1, upcoming: 2 }, completion: 0, due: [], feedback: [] }
  assert.equal(s360HomeworkNote(h), '1 missing · 2 due'); assert.equal(s360HomeworkNote({ ...h, assigned: 0 }), 'No homework set yet')
  const e: Student360['exams'] = { upcoming: [], published: 2, obtained: 150, maximum: 200, percent: 75, grade: 'B', passed: 2, failed: 0, latest: [] }
  assert.equal(s360ExamsNote(e), '2 passed · 0 below pass'); assert.equal(s360ExamsNote({ ...e, published: 0 }), 'No published results yet')
  assert.equal(s360FeesNote({ available: false, reason: 'Fee details are shown to the school office and the family.' }), 'Fee details are shown to the school office and the family.')
  assert.equal(s360FeesNote({ available: true, charges: 2, applicable: 100, paid: 100, outstanding: 0, overdue: 0, currency: 'INR', recentPayments: [] }), 'All charges settled')
})

test('the timeline groups by day and every kind has an icon', () => {
  const at = (iso: string, kind = 'homework') => ({ at: iso, kind, title: 't', detail: '', source: kind })
  assert.deepEqual(s360EventsByDay([at('2026-10-05T09:00:00Z'), at('2026-10-05T07:00:00Z', 'attendance'), at('2026-10-04T10:00:00Z')]).map(d => [d.day, d.events.length]), [['2026-10-05', 2], ['2026-10-04', 1]])
  for (const k of ['attendance', 'homework', 'exam', 'result', 'fee', 'payment', 'document']) assert.ok(s360EventIcon(k))
})
