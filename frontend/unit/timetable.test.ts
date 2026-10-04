import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gridRows, daysShown, position, minutes, dayName, shiftDate, teacherShown, statusWord, statusTone, nextSchoolDay, type Period, type Slot } from '../src/pages/suite/timetable.ts'

const slot = (id: string, name: string, order: number, startsAt: string, endsAt: string, type = 'Teaching'): Slot => ({ id, name, order, startsAt, endsAt, type })
const period = (id: string, day: string, startsAt: string, endsAt: string, extra: Partial<Period> = {}): Period => ({ id, day, startsAt, endsAt, slotId: '', room: '', yearId: '', classId: 'C1', className: 'Grade 6 - A', subjectId: 'S1', subjectName: 'Maths', teacherId: 'T1', teacherName: 'Ravi Kumar', ...extra })

test('the grid follows the period structure and places lessons in their period; other times get their own row', () => {
  const rows = gridRows([slot('s2', 'Period 2', 2, '09:45', '10:30'), slot('b', 'Break', 3, '10:30', '10:45', 'Break'), slot('s1', 'Period 1', 1, '09:00', '09:45')],
    [period('a', 'Monday', '09:45', '10:30'), period('b', 'Tuesday', '09:00', '09:45', { className: 'Grade 7 - B' }), period('c', 'Monday', '14:00', '14:40')])
  assert.deepEqual(rows.map(r => [r.name, r.startsAt, r.type]), [['Period 1', '09:00', 'Teaching'], ['Period 2', '09:45', 'Teaching'], ['Break', '10:30', 'Break'], ['', '14:00', 'Teaching']])
  assert.equal(rows[1]!.cells.Monday![0]!.id, 'a'); assert.equal(rows[0]!.cells.Tuesday![0]!.className, 'Grade 7 - B'); assert.equal(rows[3]!.cells.Monday![0]!.id, 'c')
  assert.deepEqual(daysShown(rows), ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])
  assert.deepEqual(daysShown(gridRows([], [period('x', 'Saturday', '09:00', '09:45')])), ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])
})

test('a day knows which period is on and which comes next', () => {
  const rows = [{ startsAt: '09:00', endsAt: '09:45' }, { startsAt: '09:45', endsAt: '10:30' }, { startsAt: '11:00', endsAt: '11:45' }]
  assert.deepEqual(position(rows, 8 * 60), { current: -1, next: 0 }); assert.deepEqual(position(rows, 9 * 60 + 10), { current: 0, next: 1 })
  assert.deepEqual(position(rows, 10 * 60 + 40), { current: -1, next: 2 }); assert.deepEqual(position(rows, 11 * 60 + 30), { current: 2, next: -1 }); assert.deepEqual(position(rows, 13 * 60), { current: -1, next: -1 })
  assert.equal(minutes('09:45'), 585); assert.equal(minutes('9:45'), -1); assert.equal(minutes(''), -1)
})

test('dates and weekdays line up with the timetable names', () => {
  assert.equal(dayName(new Date(2026, 9, 5)), 'Monday'); assert.equal(dayName(new Date(2026, 9, 11)), 'Sunday')
  assert.equal(shiftDate('2026-10-05', 1), '2026-10-06'); assert.equal(shiftDate('2026-10-05', -1), '2026-10-04'); assert.equal(shiftDate('2026-10-31', 1), '2026-11-01')
  assert.equal(nextSchoolDay('2026-10-10', gridRows([slot('s1', 'P1', 1, '09:00', '09:45')], [])), '2026-10-12')
})

test('a reader sees the substitute as the teacher, and the office sees the cover state', () => {
  const covered = period('a', 'Monday', '09:00', '09:45', { substituted: true, effectiveTeacherName: 'Meera Nair', status: 'covered', substitution: { id: 'x', teacherId: 'T2', teacherName: 'Meera Nair', note: '', version: 1 } })
  assert.equal(teacherShown(covered), 'Meera Nair'); assert.equal(teacherShown(period('b', 'Monday', '09:00', '09:45')), 'Ravi Kumar')
  assert.equal(statusWord(covered), 'Covered by Meera Nair'); assert.equal(statusTone(covered), 'active')
  const uncovered = period('c', 'Monday', '09:00', '09:45', { status: 'uncovered', away: true })
  assert.equal(statusWord(uncovered), 'Needs cover'); assert.equal(statusTone(uncovered), 'important')
  const covering = period('d', 'Monday', '09:00', '09:45', { covering: true, originalTeacherName: 'Ravi Kumar' })
  assert.equal(statusWord(covering), 'Covering for Ravi Kumar'); assert.equal(statusWord(period('e', 'Monday', '09:00', '09:45')), '')
})
