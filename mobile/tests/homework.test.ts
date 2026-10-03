import test from 'node:test'
import assert from 'node:assert/strict'
import { GROUP_LABEL, HOMEWORK_GROUPS, MODE_LABEL, OUTCOMES, groupTone, handInLabel, marksLabel, mayHandIn, needsAttention, overviewTotals, studentSubmits, tracked, type BoardItem, type OverviewItem, type SubmissionMode } from '../src/features/logic.ts'
import { resolveNotificationRoute } from '../src/notifications/routes.ts'
import type { User } from '../src/session/types.ts'

const base = { id: 'h1', title: 'Fractions', className: 'Grade 6 - A', subjectName: 'Mathematics', teacher: 'Ravi Kumar', instructions: 'Page 4', dueDate: '2026-10-07', dueTime: '15:30', maxMarks: '20', submissionMode: 'Text' as SubmissionMode, status: 'Published' as const, attachments: 0 }
const item = (group: BoardItem['group'], dueDate = '2026-10-07', submission: BoardItem['submission'] = null, status: BoardItem['status'] = 'Published'): BoardItem => ({ ...base, dueDate, group, submission, status })
const sub = { id: 's1', version: 2, status: 'Submitted' as const, submittedAt: '2026-10-06T10:00:00Z', late: false, outcome: '' as const, response: 'Done', grade: '', feedback: '', resubmissions: 1, attachments: 0 }

test('submission modes: a tap, a written answer or files for the student; everything but information-only is checked by the teacher', () => {
  const modes: SubmissionMode[] = ['None', 'Done', 'Text', 'File', 'Physical']
  for (const m of modes) assert.ok(MODE_LABEL[m])
  assert.deepEqual(modes.filter(studentSubmits), ['Done', 'Text', 'File']); assert.deepEqual(modes.filter(tracked), ['Done', 'Text', 'File', 'Physical'])
  assert.deepEqual(OUTCOMES, ['Completed', 'Late', 'Missing', 'Excused'])
  assert.equal(handInLabel({ ...item('upcoming'), submissionMode: 'Done' }), 'Mark as done'); assert.equal(handInLabel({ ...item('submitted', '2026-10-07', sub), submissionMode: 'Done' }), 'Marked as done'); assert.equal(handInLabel(item('submitted', '2026-10-07', sub)), 'Hand in again')
  assert.equal(mayHandIn({ ...item('upcoming'), submissionMode: 'Physical' }), false); assert.equal(mayHandIn({ ...item('upcoming'), submissionMode: 'Done' }), true)
  assert.equal(mayHandIn(item('excused', '2026-10-07', { ...sub, outcome: 'Excused' })), false)
})

test('every group has a label and a tone, and attention goes to what is still open', () => {
  for (const g of HOMEWORK_GROUPS) assert.ok(GROUP_LABEL[g])
  assert.equal(groupTone('missing'), 'danger'); assert.equal(groupTone('late'), 'warning'); assert.equal(groupTone('reviewed'), 'success'); assert.equal(groupTone('due-today'), 'primary')
  const items = [item('upcoming', '2026-10-09'), item('reviewed', '2026-10-01'), item('missing', '2026-10-02'), item('due-today', '2026-10-05')]
  assert.deepEqual(needsAttention(items).map(i => i.group), ['missing', 'due-today', 'upcoming'])
})

test('a student may hand in only while published, taking submissions and not yet reviewed', () => {
  assert.equal(mayHandIn(item('upcoming')), true)
  assert.equal(mayHandIn(item('missing')), true)                                   // late, but still allowed; the server marks it late
  assert.equal(mayHandIn(item('submitted', '2026-10-07', sub)), true)              // handing in again is allowed
  assert.equal(mayHandIn(item('reviewed', '2026-10-07', { ...sub, status: 'Reviewed' })), false)
  assert.equal(mayHandIn(item('closed', '2026-10-07', null, 'Closed')), false)
  assert.equal(mayHandIn({ ...item('upcoming'), submissionMode: 'None' }), false)
})

test('marks and overview totals read as the web does', () => {
  assert.equal(marksLabel({ ...sub, grade: '17' }, '20'), '17 / 20'); assert.equal(marksLabel({ ...sub, grade: 'A' }, ''), 'A'); assert.equal(marksLabel(null, '20'), '')
  const rows: OverviewItem[] = [{ ...base, assigned: 20, submitted: 15, late: 2, reviewed: 10, pending: 5, missing: 5 }, { ...base, id: 'h2', status: 'Draft', assigned: 20, submitted: 0, late: 0, reviewed: 0, pending: 0, missing: 0 }]
  assert.deepEqual(overviewTotals(rows), { toReview: 5, missing: 5, late: 2, published: 1 })
})

test('a review notification opens Homework for the family', () => {
  const person = (dataScope: string, permissions: string[]): User => ({ id: 'u', username: 'u', email: '', firstName: '', lastName: '', schoolId: 's', roles: [], permissions, dataScope })
  assert.equal(resolveNotificationRoute({ type: 'homework.reviewed' }, person('student', ['homework.view'])).route, '/homework')
  assert.equal(resolveNotificationRoute({ type: 'homework.reviewed' }, person('parent', ['homework.view'])).route, '/homework')
})
