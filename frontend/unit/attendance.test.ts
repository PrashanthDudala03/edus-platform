// Run with `npm run test:unit`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { changes, classesOf, filterRows, isCorrection, markRestPresent, mayHaveReason, percent, stateTone, submittedClasses, summary, type ClassRegister, type RegisterRow } from '../src/pages/suite/attendance.ts'

const rows: RegisterRow[] = [
  { id: 'a', code: 'S1', name: 'Aarav Sharma', class: 'Grade 6 - A', status: 'Present', reason: null, remark: null },
  { id: 'b', code: 'S2', name: 'Diya Sharma', class: 'Grade 6 - A', status: null, reason: null, remark: null },
  { id: 'c', code: 'S3', name: 'Rohan Das', class: 'Grade 3 - B', status: 'Absent', reason: 'Sick', remark: null },
]
const register = (className: string, state: string): ClassRegister => ({ className, expected: 2, marked: 2, present: 2, absent: 0, late: 0, excused: 0, state, teacher: null, submittedAt: null, correctedAt: null, submittedBy: null })

test('the summary counts saved and unsaved marks', () => {
  assert.deepEqual(summary(rows, {}), { Present: 1, Late: 0, Absent: 1, Excused: 0, unmarked: 1, total: 3 })
  assert.deepEqual(summary(rows, { b: { status: 'Late' } }), { Present: 1, Late: 1, Absent: 1, Excused: 0, unmarked: 0, total: 3 })
})

test('only real changes are sent, and a reason travels only with a status that can carry one', () => {
  assert.deepEqual(changes(rows, { a: { status: 'Present' } }), [])                                         // same as saved
  assert.deepEqual(changes(rows, { c: { status: 'Absent' } }), [])                                          // same status and the saved reason is kept
  assert.deepEqual(changes(rows, { b: { status: 'Absent', reason: 'Sick' } }), [{ studentId: 'b', status: 'Absent', reason: 'Sick', remark: '' }])
  assert.deepEqual(changes(rows, { c: { status: 'Present', reason: 'Sick' } }), [{ studentId: 'c', status: 'Present', reason: '', remark: '' }])
  assert.deepEqual(changes(rows, { c: { status: 'Absent', remark: 'Called in' } }), [{ studentId: 'c', status: 'Absent', reason: 'Sick', remark: 'Called in' }])
})

test('"mark the rest present" fills only the unmarked and keeps choices', () => {
  assert.deepEqual(markRestPresent(rows, { c: { status: 'Late' } }), { c: { status: 'Late' }, b: { status: 'Present' } })
  assert.equal(mayHaveReason('Present'), false); assert.equal(mayHaveReason('Excused'), true)
})

test('a change to a submitted class is a correction', () => {
  const submitted = submittedClasses([register('Grade 6 - A', 'Submitted'), register('Grade 3 - B', 'In progress'), register('Grade 1 - C', 'Corrected')])
  assert.deepEqual([...submitted].sort(), ['Grade 1 - C', 'Grade 6 - A'])
  assert.equal(isCorrection(rows, { c: { status: 'Present' } }, submitted), false)   // Grade 3 - B is not submitted
  assert.equal(isCorrection(rows, { a: { status: 'Late' } }, submitted), true)
  assert.equal(isCorrection(rows, { a: { status: 'Present' } }, submitted), false)   // nothing changed
})

test('classes, filtering, tones and percentages', () => {
  assert.deepEqual(classesOf(rows), ['Grade 3 - B', 'Grade 6 - A'])
  assert.deepEqual(filterRows(rows, 'Grade 6 - A', 'diya').map(r => r.id), ['b'])
  assert.deepEqual(filterRows(rows, '', 's2').map(r => r.id), ['b'])
  assert.equal(stateTone('Submitted'), 'active'); assert.equal(stateTone('In progress'), 'important'); assert.equal(stateTone('Not started'), '')
  assert.equal(percent(18, 20), 90); assert.equal(percent(0, 0), null)
})
