import test from 'node:test'
import assert from 'node:assert/strict'
import { EXAM_STATUSES, EXAM_STATUS_LABEL, changedMarks, componentsLabel, examActions, examTime, examTone, examTotals, examsByDay, markGrade, markLabel, markProblem, markTotal, resultLabel, splitExams, toMarkEntry, type ExamOverview, type ReportResult, type Scheme, type SheetRow } from '../src/features/logic.ts'
import { resolveNotificationRoute } from '../src/notifications/routes.ts'
import type { User } from '../src/session/types.ts'

const parts: Scheme = { type: 'Components', max: 100, passMarks: 40, gradeOnly: false, components: [{ name: 'Theory', max: 70, pass: 28 }, { name: 'Practical', max: 30, pass: null }], grades: [{ label: 'A', minPercent: 90 }, { label: 'B', minPercent: 75 }, { label: 'E', minPercent: 0 }] }
const grade: Scheme = { type: 'Grade', max: 0, passMarks: null, gradeOnly: true, components: [], grades: [{ label: 'A+', minPercent: 90 }, { label: 'B', minPercent: 0 }] }
const exam: ExamOverview = { id: 'e1', version: 2, name: 'Half-yearly', term: 'Term 1', className: 'Grade 6 - A', subjectName: 'Science', date: '2026-10-20', startsAt: '09:00', endsAt: '11:00', room: 'Hall B', instructions: '', schemeName: 'Theory + Practical', maxMarks: '100', status: 'MarksEntry', resultsVisible: false, returnReason: '', assigned: 20, entered: 12, missing: 8, absent: 1, exempt: 0, average: null, passed: 0, failed: 0 }
const row = (studentId: string, mark: SheetRow['mark']): SheetRow => ({ studentId, name: 'S ' + studentId, code: studentId, mark })
const held: NonNullable<SheetRow['mark']> = { id: 'm', version: 1, status: 'Present', score: 56, grade: 'E', pass: true, components: [{ name: 'Theory', max: 70, score: 40 }, { name: 'Practical', max: 30, score: 16 }], remarks: '' }

test('statuses, tones, times and the timetable split read as the web does', () => {
  for (const s of EXAM_STATUSES) assert.ok(EXAM_STATUS_LABEL[s])
  assert.equal(examTone('Published'), 'success'); assert.equal(examTone('Submitted'), 'warning'); assert.equal(examTone('Draft'), 'neutral')
  assert.equal(examTime(exam), '09:00–11:00'); assert.equal(examTime({ startsAt: '', endsAt: '' }), '')
  const items = [{ date: '2026-10-01' }, { date: '2026-10-20' }, { date: '2026-10-20' }, { date: '2026-10-22' }]
  assert.deepEqual(splitExams(items, '2026-10-05'), { upcoming: items.slice(1), held: [items[0]] })
  assert.deepEqual(examsByDay(items.slice(1)).map(d => [d.date, d.items.length]), [['2026-10-20', 2], ['2026-10-22', 1]])
  assert.deepEqual(examTotals([exam, { ...exam, id: 'e2', status: 'Submitted' }, { ...exam, id: 'e3', status: 'Published', resultsVisible: true, missing: 0 }]), { exams: 3, pendingApproval: 1, entryIncomplete: 1, published: 1, entered: 36, expected: 60 })
})

test('a teacher submits once marks are in; leadership approves, returns with a reason, or publishes', () => {
  assert.deepEqual(examActions('MarksEntry', { leadership: false, teacher: true, entered: 12 }).map(a => a.to), ['Submitted'])
  assert.deepEqual(examActions('MarksEntry', { leadership: false, teacher: true, entered: 0 }), [])
  assert.deepEqual(examActions('Submitted', { leadership: false, teacher: true, entered: 12 }), [])
  assert.deepEqual(examActions('Submitted', { leadership: true, teacher: false, entered: 0 }).map(a => [a.to, !!a.reason]), [['Approved', false], ['MarksEntry', true]])
  assert.deepEqual(examActions('Approved', { leadership: true, teacher: false, entered: 0 }).map(a => a.to), ['Published', 'MarksEntry'])
  assert.deepEqual(examActions('Published', { leadership: true, teacher: false, entered: 0 }), [])
})

test('the marksheet totals and grades a present student, refuses out-of-range marks, and sends only complete changes', () => {
  const r1 = row('1', held), r2 = row('2', null), e1 = toMarkEntry(r1, parts)
  assert.deepEqual(e1, { status: 'Present', components: { Theory: '40', Practical: '16' }, grade: '', remarks: '' })
  assert.equal(markTotal(e1, parts), 56); assert.equal(markTotal({ ...e1, components: { Theory: '40', Practical: '' } }, parts), null); assert.equal(markTotal({ ...e1, status: 'Absent' }, parts), null)
  assert.equal(markGrade(parts, 92), 'A'); assert.equal(markGrade(parts, 50), 'E')
  assert.equal(markProblem({ ...e1, components: { Theory: '71', Practical: '0' } }, parts), 'Theory must be between 0 and 70')
  assert.equal(markProblem({ status: 'Present', components: {}, grade: 'Z', remarks: '' }, grade), 'Use one of A+, B'); assert.equal(markProblem({ status: 'Present', components: {}, grade: 'b', remarks: '' }, grade), null)
  assert.equal(markProblem({ ...e1, status: 'Exempt', components: { Theory: '999' } }, parts), null)
  assert.deepEqual(changedMarks([r1, r2], { '1': e1, '2': { status: 'Present', components: { Theory: '50', Practical: '' }, grade: '', remarks: '' } }, parts), [])
  assert.deepEqual(changedMarks([r1, r2], { '1': { ...e1, components: { Theory: '45', Practical: '16' } }, '2': { status: 'Absent', components: {}, grade: '', remarks: 'Sick' } }, parts),
    [{ studentId: '1', status: 'Present', components: { Theory: 45, Practical: 16 }, grade: '', remarks: '', version: 1 }, { studentId: '2', status: 'Absent', components: {}, grade: '', remarks: 'Sick', version: undefined }])
  assert.equal(markLabel({ ...held, score: 81, grade: 'B' }, parts), '81 / 100 · B'); assert.equal(markLabel({ ...held, status: 'Absent' }, parts), 'Absent'); assert.equal(markLabel(null, parts), '')
})

test('results read with components, absent and exempt, and exam notifications open Exams', () => {
  const r: ReportResult = { exam: 'Half-yearly', term: 'Term 1', subject: 'Science', status: 'Present', components: [{ name: 'Theory', max: 70, score: 56 }, { name: 'Practical', max: 30, score: 25 }], score: 81, maximum: 100, grade: 'B', pass: true, remarks: '' }
  assert.equal(componentsLabel(r.components), 'Theory 56/70 · Practical 25/30'); assert.equal(componentsLabel([{ name: 'Marks', max: 100, score: 80 }]), '')
  assert.equal(resultLabel(r), '81 / 100'); assert.equal(resultLabel({ ...r, status: 'Absent' }), 'Absent'); assert.equal(resultLabel({ ...r, status: 'Exempt' }), 'Exempt'); assert.equal(resultLabel({ ...r, maximum: null, score: null, grade: 'A+' }), 'A+')
  const person = (dataScope: string, permissions: string[]): User => ({ id: 'u', username: 'u', email: '', firstName: '', lastName: '', schoolId: 's', roles: [], permissions, dataScope })
  assert.equal(resolveNotificationRoute({ type: 'exam.scheduled' }, person('parent', ['exams.view'])).route, '/exams')
  assert.equal(resolveNotificationRoute({ type: 'exam.rescheduled' }, person('student', ['exams.view'])).route, '/exams')
  assert.equal(resolveNotificationRoute({ type: 'result.published' }, person('student', ['reports.view'])).route, '/results')
})
