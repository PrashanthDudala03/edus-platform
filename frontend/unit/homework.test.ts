// Run with `npm run test:unit`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { GROUPS, GROUP_LABEL, MODES, MODE_HELP, MODE_LABEL, OUTCOMES, dueLabel, emptyDraft, groupTone, handInLabel, marksLabel, needsAttention, nextStatuses, overviewTotals, studentSubmits, toDraft, tracked, type Assignment, type BoardItem, type OverviewItem } from '../src/pages/suite/homework.ts'

const base: Assignment = { id: 'h1', title: 'Fractions', classId: 'c1', className: 'Grade 6 - A', subjectId: 's1', subjectName: 'Mathematics', teacher: 'Ravi Kumar', instructions: 'Do page 4', dueDate: '2026-10-07', dueTime: '15:30', maxMarks: '20', submissionMode: 'Text', status: 'Published', publishedOn: '2026-10-05', attachments: 1 }
const item = (group: BoardItem['group'], dueDate = '2026-10-07', submission: BoardItem['submission'] = null): BoardItem => ({ ...base, dueDate, group, submission })

test('every group has a label and a tone', () => {
  for (const g of GROUPS) assert.ok(GROUP_LABEL[g])
  assert.equal(groupTone('missing'), 'important'); assert.equal(groupTone('late'), 'important'); assert.equal(groupTone('reviewed'), 'active'); assert.equal(groupTone('upcoming'), ''); assert.equal(groupTone('excused'), '')
})

test('submission modes: zero-upload by default, files only when the teacher chooses them', () => {
  assert.equal(emptyDraft('2026-10-05').submissionMode, 'Done')
  assert.deepEqual(MODES, ['Done', 'Text', 'File', 'Physical', 'None']); assert.deepEqual(OUTCOMES, ['Completed', 'Late', 'Missing', 'Excused'])
  for (const m of MODES) { assert.ok(MODE_LABEL[m]); assert.ok(MODE_HELP[m]) }
  assert.ok(studentSubmits('Done') && studentSubmits('Text') && studentSubmits('File')); assert.ok(!studentSubmits('Physical') && !studentSubmits('None'))
  assert.ok(tracked('Physical') && !tracked('None'))
  const sub = { id: 's', version: 1, status: 'Submitted' as const, submittedAt: '2026-10-06T09:00:00Z', late: false, outcome: '' as const, verifiedAt: '', response: '', grade: '', feedback: '', reviewedAt: '', resubmissions: 0 }
  assert.equal(handInLabel({ ...item('upcoming'), submissionMode: 'Done' }), 'Mark as done'); assert.equal(handInLabel({ ...item('submitted', '2026-10-07', sub), submissionMode: 'Done' }), 'Marked as done')
  assert.equal(handInLabel(item('upcoming')), 'Hand in'); assert.equal(handInLabel(item('submitted', '2026-10-07', sub)), 'Hand in again')
})

test('what needs attention is due today, upcoming and missing work, soonest first', () => {
  const items = [item('upcoming', '2026-10-09'), item('reviewed', '2026-10-01'), item('missing', '2026-10-02'), item('due-today', '2026-10-05'), item('submitted', '2026-10-06')]
  assert.deepEqual(needsAttention(items).map(i => i.group), ['missing', 'due-today', 'upcoming'])
})

test('due and marks read naturally', () => {
  assert.equal(dueLabel(base), 'Wed, 7 Oct 15:30')
  assert.equal(dueLabel({ dueDate: '2026-10-07', dueTime: '' }), 'Wed, 7 Oct')
  assert.equal(dueLabel({ dueDate: '', dueTime: '' }), '')
  const sub = { id: 's', version: 1, status: 'Reviewed' as const, submittedAt: '', late: false, outcome: '' as const, verifiedAt: '', response: '', grade: '17', feedback: 'Good', reviewedAt: '', resubmissions: 0 }
  assert.equal(marksLabel(sub, '20'), '17 / 20'); assert.equal(marksLabel(sub, ''), '17'); assert.equal(marksLabel({ ...sub, grade: '' }, '20'), ''); assert.equal(marksLabel(null, '20'), '')
})

test('the overview totals add up what a teacher still has to do', () => {
  const rows: OverviewItem[] = [{ ...base, assigned: 20, submitted: 15, late: 2, reviewed: 10, pending: 5, missing: 5, overdue: true }, { ...base, id: 'h2', status: 'Draft', assigned: 20, submitted: 0, late: 0, reviewed: 0, pending: 0, missing: 0, overdue: false }]
  assert.deepEqual(overviewTotals(rows), { toReview: 5, missing: 5, late: 2, published: 1, drafts: 1 })
})

test('the editor offers only the allowed next statuses', () => {
  assert.deepEqual(nextStatuses('', 0), ['Draft', 'Published'])
  assert.deepEqual(nextStatuses('Draft', 0), ['Draft', 'Published'])
  assert.deepEqual(nextStatuses('Published', 0), ['Draft', 'Published', 'Closed'])
  assert.deepEqual(nextStatuses('Published', 3), ['Published', 'Closed'])
  assert.deepEqual(nextStatuses('Closed', 3), ['Closed', 'Published'])
  assert.equal(emptyDraft('2026-10-05').status, 'Draft')
  assert.deepEqual(toDraft(base), { title: 'Fractions', classId: 'c1', subjectId: 's1', dueDate: '2026-10-07', dueTime: '15:30', maxMarks: '20', submissionMode: 'Text', status: 'Published', instructions: 'Do page 4' })
})
