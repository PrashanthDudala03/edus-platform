import test from 'node:test'
import assert from 'node:assert/strict'
import { REASONS, isCorrection, mayHaveReason, registerDone, registerEntries, submittedClasses, type ClassRegister, type RegisterRow } from '../src/features/logic.ts'
import { resolveNotificationRoute } from '../src/notifications/routes.ts'
import type { User } from '../src/session/types.ts'

const row = (id: string, status: RegisterRow['status'], className = '8 - A', reason = '', remark = ''): RegisterRow => ({ id, code: 'R' + id, name: 'Student ' + id, className, status, reason, remark })
const register = (className: string, state: string): ClassRegister => ({ className, expected: 2, marked: 2, present: 2, absent: 0, late: 0, excused: 0, state, teacher: '', submittedAt: '' })

test('reasons go only with absent, late and excused, and only real changes are sent', () => {
  assert.equal(mayHaveReason('Present'), false); assert.equal(mayHaveReason('Late'), true); assert.equal(mayHaveReason(''), false)
  assert.ok(REASONS.includes('Sick') && REASONS.includes('Other'))
  const rows = [row('1', 'Present'), row('2', ''), row('3', 'Absent', '8 - A', 'Sick')]
  assert.deepEqual(registerEntries(rows, { '1': 'Present' }), [])
  assert.deepEqual(registerEntries(rows, { '3': 'Absent' }), [], 'the saved reason is kept, so nothing changed')
  assert.deepEqual(registerEntries(rows, { '2': 'Absent' }, { '2': { reason: 'Transport delay', remark: 'Bus' } }), [{ studentId: '2', status: 'Absent', reason: 'Transport delay', remark: 'Bus' }])
  assert.deepEqual(registerEntries(rows, { '3': 'Present' }, { '3': { reason: 'Sick', remark: '' } }), [{ studentId: '3', status: 'Present', reason: '', remark: '' }], 'a reason never travels with Present')
  assert.deepEqual(registerEntries(rows, { ghost: 'Present' }), [])
})

test('a change to a submitted class is a correction', () => {
  const rows = [row('1', 'Present', '8 - A'), row('2', 'Absent', '9 - B')]
  const submitted = submittedClasses([register('8 - A', 'Submitted'), register('9 - B', 'In progress'), register('7 - C', 'Corrected')])
  assert.deepEqual([...submitted].sort(), ['7 - C', '8 - A'])
  assert.equal(isCorrection(rows, { '2': 'Present' }, submitted), false)
  assert.equal(isCorrection(rows, { '1': 'Late' }, submitted), true)
  assert.equal(isCorrection(rows, { '1': 'Present' }, submitted), false)
  assert.equal(registerDone('Submitted'), true); assert.equal(registerDone('Marked'), false)
})

test('late and corrected notifications open the attendance screens for the role', () => {
  const person = (dataScope: string, permissions: string[]): User => ({ id: 'u', username: 'u', email: '', firstName: '', lastName: '', schoolId: 's', roles: [], permissions, dataScope })
  for (const type of ['attendance.late', 'attendance.corrected']) {
    assert.equal(resolveNotificationRoute({ type }, person('parent', ['reports.view'])).route, '/children')
    assert.equal(resolveNotificationRoute({ type }, person('teacher', ['attendance.view'])).route, '/register')
  }
})
