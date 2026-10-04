import test from 'node:test'
import assert from 'node:assert/strict'
import { dayRows, shownRows, positionOf, nextLesson, periodNote, periodTone, dateOf, weekStart, weekdayOfDate, impactWord, minutesOf, type Period, type Slot } from '../src/features/timetable.ts'
import { leaveDaysOf } from '../src/features/logic.ts'

const slot = (id: string, name: string, order: number, startsAt: string, endsAt: string, type = 'Teaching'): Slot => ({ id, name, order, startsAt, endsAt, type })
const period = (id: string, startsAt: string, endsAt: string, extra: Partial<Period> = {}): Period => ({ id, day: 'Monday', startsAt, endsAt, slotId: '', room: '', classId: 'C1', className: 'Grade 6 - A', subjectId: 'S1', subjectName: 'Maths', teacherId: 'T1', teacherName: 'Ravi Kumar', ...extra })

test('a day is the school periods in order with lessons placed in them; a day with no lessons is empty', () => {
  const rows = dayRows([slot('b', 'Break', 3, '10:30', '10:45', 'Break'), slot('s1', 'Period 1', 1, '09:00', '09:45'), slot('s2', 'Period 2', 2, '09:45', '10:30')], [period('a', '09:45', '10:30'), period('x', '14:00', '14:40')])
  assert.deepEqual(rows.map(r => [r.name, r.startsAt, r.periods.length]), [['Period 1', '09:00', 0], ['Period 2', '09:45', 1], ['Break', '10:30', 0], ['', '14:00', 1]])
  assert.deepEqual(shownRows(rows).map(r => r.startsAt), ['09:45', '10:30', '14:00'])
  assert.deepEqual(shownRows(dayRows([slot('s1', 'Period 1', 1, '09:00', '09:45')], [])), [])
  assert.equal(minutesOf('09:45'), 585); assert.equal(minutesOf('bad'), -1)
})

test('the day knows which row is on and which lesson comes next', () => {
  const rows = dayRows([], [period('a', '09:00', '09:45'), period('b', '09:45', '10:30'), period('c', '11:00', '11:45')])
  assert.deepEqual(positionOf(rows, 8 * 60), { current: -1, next: 0 }); assert.deepEqual(positionOf(rows, 9 * 60 + 10), { current: 0, next: 1 }); assert.deepEqual(positionOf(rows, 10 * 60 + 40), { current: -1, next: 2 }); assert.deepEqual(positionOf(rows, 13 * 60), { current: -1, next: -1 })
  assert.equal(nextLesson(rows, 9 * 60 + 10)?.key, '09:00-09:45'); assert.equal(nextLesson(rows, 10 * 60 + 40)?.key, '11:00-11:45'); assert.equal(nextLesson(rows, 13 * 60), undefined)
})

test('a period is worded for its reader: the substitute as the teacher, cover states for staff', () => {
  const covered = period('a', '09:00', '09:45', { substituted: true, effectiveTeacherName: 'Meera Nair', status: 'covered', substitution: { id: 'x', teacherId: 'T2', teacherName: 'Meera Nair', note: '', version: 1 }, room: '4' })
  assert.equal(periodNote(covered, false), 'Meera Nair · Room 4 · Covered by Meera Nair'); assert.equal(periodTone(covered), 'primary')
  assert.equal(periodNote(period('b', '09:00', '09:45', { substituted: true, effectiveTeacherName: 'Meera Nair' }), false), 'Meera Nair · Substitute')
  assert.equal(periodNote(period('c', '09:00', '09:45', { status: 'uncovered', away: true }), true), 'Grade 6 - A · Needs cover'); assert.equal(periodTone(period('c', '09:00', '09:45', { status: 'uncovered' })), 'warning')
  assert.equal(periodNote(period('d', '09:00', '09:45', { covering: true, originalTeacherName: 'Ravi Kumar' }), true), 'Grade 6 - A · Covering for Ravi Kumar')
  assert.equal(periodNote(period('e', '09:00', '09:45'), false), 'Ravi Kumar'); assert.equal(periodTone(period('e', '09:00', '09:45')), 'neutral')
})

test('dates, weeks and leave days line up with the server', () => {
  assert.equal(dateOf('2026-10-05', 1), '2026-10-06'); assert.equal(dateOf('2026-10-31', 1), '2026-11-01'); assert.equal(weekStart('2026-10-08'), '2026-10-05'); assert.equal(weekStart('2026-10-05'), '2026-10-05'); assert.equal(weekStart('2026-10-11'), '2026-10-05')
  assert.equal(weekdayOfDate('2026-10-05'), 'Monday'); assert.equal(weekdayOfDate('2026-10-11'), 'Sunday')
  assert.equal(leaveDaysOf('2026-10-05', '2026-10-07'), 3); assert.equal(leaveDaysOf('2026-10-05', '2026-10-05', 'First half'), 0.5); assert.equal(leaveDaysOf('2026-10-07', '2026-10-05'), 0)
  assert.equal(impactWord({ affected: 0, covered: 0, uncovered: 0 }), 'No lessons affected'); assert.equal(impactWord({ affected: 2, covered: 2, uncovered: 0 }), '2 lessons, all covered'); assert.equal(impactWord({ affected: 3, covered: 1, uncovered: 2 }), '2 of 3 lessons need cover')
})
