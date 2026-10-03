// Run with `npm run test:unit`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { STATUSES, STATUS_LABEL, analytics, byDay, changedEntries, completion, componentsLabel, entryProblem, entryTotal, gradeFor, marksEditable, marksLabel, nextActions, statusTone, timeLabel, toDraft, toEntry, upcoming, type Exam, type OverviewExam, type Scheme, type SheetRow } from '../src/pages/suite/exams.ts'

const marks: Scheme = { type: 'Marks', max: 100, passMarks: 40, gradeOnly: false, components: [{ name: 'Marks', max: 100, pass: null }], grades: [{ label: 'A', minPercent: 90 }, { label: 'B', minPercent: 75 }, { label: 'C', minPercent: 60 }, { label: 'D', minPercent: 40 }, { label: 'E', minPercent: 0 }] }
const parts: Scheme = { ...marks, type: 'Components', components: [{ name: 'Theory', max: 70, pass: 28 }, { name: 'Practical', max: 30, pass: null }] }
const grade: Scheme = { type: 'Grade', max: 0, passMarks: null, gradeOnly: true, components: [], grades: [{ label: 'A+', minPercent: 90 }, { label: 'A', minPercent: 75 }, { label: 'B', minPercent: 0 }] }
const exam: Exam = { id: 'e1', version: 2, name: 'Half-yearly', term: 'Term 1', yearId: 'y1', yearName: '2026-27', classId: 'c1', className: 'Grade 6 - A', subjectId: 's1', subjectName: 'Mathematics', date: '2026-10-20', startsAt: '09:00', endsAt: '11:00', room: 'Hall B', instructions: '', schemeId: '', schemeName: '', schemeType: 'Marks', maxMarks: '100', passMarks: '40', status: 'Scheduled', resultsVisible: false }
const row = (studentId: string, mark: SheetRow['mark']): SheetRow => ({ studentId, name: 'Student ' + studentId, code: 'S' + studentId, mark })
const held = (over: Partial<SheetRow['mark']> & {}): NonNullable<SheetRow['mark']> => ({ id: 'm', version: 1, status: 'Present', score: 56, grade: 'E', pass: true, components: [{ name: 'Theory', max: 70, score: 40 }, { name: 'Practical', max: 30, score: 16 }], remarks: '', enteredAt: '', changes: 0, ...over })

test('every status has a label and a tone, and the timetable groups by day', () => {
  for (const s of STATUSES) assert.ok(STATUS_LABEL[s])
  assert.equal(statusTone('Published'), 'active'); assert.equal(statusTone('Submitted'), 'important'); assert.equal(statusTone('Draft'), '')
  assert.equal(timeLabel(exam), '09:00–11:00'); assert.equal(timeLabel({ startsAt: '', endsAt: '' }), '')
  const items = [{ date: '2026-10-20', id: 1 }, { date: '2026-10-20', id: 2 }, { date: '2026-10-22', id: 3 }]
  assert.deepEqual(byDay(items).map(d => [d.date, d.items.length]), [['2026-10-20', 2], ['2026-10-22', 1]])
  assert.deepEqual(upcoming(items, '2026-10-21').map(i => i.id), [3])
})

test('leadership moves exams forward or returns them; teachers only submit once marks are in', () => {
  assert.deepEqual(nextActions('Draft', { leadership: true, teacher: false, entered: 0 }).map(a => a.to), ['Scheduled'])
  assert.deepEqual(nextActions('Submitted', { leadership: true, teacher: false, entered: 0 }).map(a => a.to), ['Approved', 'MarksEntry'])
  assert.deepEqual(nextActions('Approved', { leadership: true, teacher: false, entered: 0 }).map(a => a.to), ['Published', 'MarksEntry'])
  assert.deepEqual(nextActions('Published', { leadership: true, teacher: false, entered: 0 }).map(a => a.to), ['Closed', 'Approved'])
  assert.ok(nextActions('Submitted', { leadership: true, teacher: false, entered: 0 })[1].reason)
  assert.deepEqual(nextActions('MarksEntry', { leadership: false, teacher: true, entered: 12 }).map(a => a.to), ['Submitted'])
  assert.deepEqual(nextActions('MarksEntry', { leadership: false, teacher: true, entered: 0 }), [])
  assert.deepEqual(nextActions('Submitted', { leadership: false, teacher: true, entered: 12 }), [])
  assert.deepEqual(nextActions('Published', { leadership: false, teacher: false, entered: 12 }), [])
  assert.ok(marksEditable('MarksEntry', false) && !marksEditable('Submitted', false) && marksEditable('Approved', true) && !marksEditable('Published', true))
})

test('the grid keeps what was typed, totals and grades a present student, and sends only complete changes', () => {
  const r1 = row('1', held({})), r2 = row('2', null)
  const e1 = toEntry(r1, parts); assert.deepEqual(e1, { status: 'Present', components: { Theory: '40', Practical: '16' }, grade: '', remarks: '' })
  assert.equal(entryTotal(e1, parts), 56); assert.equal(entryTotal({ ...e1, components: { Theory: '40', Practical: '' } }, parts), null); assert.equal(entryTotal({ ...e1, status: 'Absent' }, parts), null)
  assert.equal(gradeFor(marks, 92), 'A'); assert.equal(gradeFor(marks, 10), 'E'); assert.equal(gradeFor(grade, 80), 'A')
  assert.equal(entryProblem({ ...e1, components: { Theory: '71', Practical: '0' } }, parts), 'Theory must be between 0 and 70')
  assert.equal(entryProblem({ status: 'Present', components: { Marks: '101' }, grade: '', remarks: '' }, marks), 'Marks must be between 0 and 100')
  assert.equal(entryProblem({ status: 'Present', components: {}, grade: 'Z', remarks: '' }, grade), 'Use one of A+, A, B'); assert.equal(entryProblem({ status: 'Present', components: {}, grade: 'a', remarks: '' }, grade), null)
  assert.equal(entryProblem({ ...e1, status: 'Absent', components: { Theory: '999' } }, parts), null)   // absent: the figures are ignored
  // Unchanged, blank-and-new, and incomplete rows are not sent; a changed complete row is, with the record version.
  const drafts = { '1': e1, '2': { status: 'Present' as const, components: { Theory: '50', Practical: '' }, grade: '', remarks: '' } }
  assert.deepEqual(changedEntries([r1, r2], drafts, parts), [])
  const sent = changedEntries([r1, r2], { '1': { ...e1, components: { Theory: '45', Practical: '16' } }, '2': { status: 'Absent', components: {}, grade: '', remarks: 'Sick' } }, parts)
  assert.deepEqual(sent, [{ studentId: '1', status: 'Present', components: { Theory: 45, Practical: 16 }, grade: '', remarks: '', version: 1 }, { studentId: '2', status: 'Absent', components: {}, grade: '', remarks: 'Sick', version: undefined }])
  assert.equal(marksLabel(held({ score: 81, grade: 'B' }), parts), '81 / 100 · B'); assert.equal(marksLabel(held({ status: 'Absent' }), parts), 'Absent'); assert.equal(marksLabel(held({ grade: 'A' }), grade), 'A'); assert.equal(marksLabel(null, parts), '')
  assert.equal(componentsLabel(held({}).components), 'Theory 40/70 · Practical 16/30'); assert.equal(componentsLabel([{ name: 'Marks', max: 100, score: 80 }]), '')
  assert.equal(toDraft(exam).term, 'Term 1'); assert.equal(toDraft(exam).status, 'Scheduled')
})

test('analytics add up entry completion, pass rate, averages by class and subject, and the grade distribution', () => {
  const o = (over: Partial<OverviewExam>): OverviewExam => ({ ...exam, assigned: 20, entered: 20, missing: 0, absent: 1, exempt: 0, average: 70, passed: 15, failed: 4, distribution: { A: 5, B: 10, E: 4 }, scheme: marks, status: 'Published', resultsVisible: true, ...over })
  const items = [o({}), o({ id: 'e2', subjectName: 'Science', average: 60, passed: 10, failed: 9, distribution: { B: 10, E: 9 } }), o({ id: 'e3', className: 'Grade 3 - B', status: 'Submitted', resultsVisible: false, entered: 15, missing: 5, average: null }), o({ id: 'e4', status: 'MarksEntry', resultsVisible: false, entered: 2, missing: 18, average: null })]
  const a = analytics(items)
  assert.equal(a.expected, 80); assert.equal(a.entered, 57); assert.equal(a.pendingApproval, 1); assert.equal(a.entryIncomplete, 1); assert.equal(a.published, 2)
  assert.equal(a.passed, 25); assert.equal(a.failed, 13)
  assert.deepEqual(a.classes, [{ name: 'Grade 6 - A', average: 65, exams: 2, passed: 25, failed: 13 }])
  assert.deepEqual(a.subjects.map(s => [s.name, s.average]), [['Mathematics', 70], ['Science', 60]])
  assert.deepEqual(a.distribution, { A: 5, B: 20, E: 13 })
  assert.equal(completion(items[3]), 10); assert.equal(completion({ assigned: 0, entered: 0 }), 0)
})
