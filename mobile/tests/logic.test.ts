import test from 'node:test'
import assert from 'node:assert/strict'
import { classesOf, feeTotals, leaveDays, markRestPresent, money, newestFirst, recentDays, registerChanges, registerSummary, shiftDay, splitHomework, upcomingEvents, type Charge, type RegisterRow } from '../src/features/logic.ts'

const row = (id: string, status: RegisterRow['status'], className = '8 - A'): RegisterRow => ({ id, code: 'R' + id, name: 'Student ' + id, className, status })
const charge = (id: string, gross: number, concession: number, paid: number): Charge => ({ id, studentId: 's' + id, student: 'Student ' + id, description: 'Term fee', dueDate: '2026-10-10', gross, concession, paid, balance: gross - concession - paid, currency: 'INR' })

test('homework is split around today: due soonest first, past most recent first', () => {
  const items = [{ id: 'a', dueDate: '2026-10-05' }, { id: 'b', dueDate: '2026-09-28' }, { id: 'c', dueDate: '2026-10-02' }, { id: 'd', dueDate: '2026-10-01T00:00:00' }]
  const { upcoming, past } = splitHomework(items, '2026-10-02')
  assert.deepEqual(upcoming.map(i => i.id), ['c', 'a'], 'work due today is still due')
  assert.deepEqual(past.map(i => i.id), ['d', 'b'])
  assert.equal(items[0].id, 'a', 'the input is not reordered')
})

test('only events that have not ended are upcoming', () => {
  const events = [{ id: 'old', startsOn: '2026-09-01', endsOn: '2026-09-02' }, { id: 'running', startsOn: '2026-09-30', endsOn: '2026-10-03' }, { id: 'next', startsOn: '2026-10-10', endsOn: '2026-10-10' }, { id: 'open', startsOn: '2026-10-04', endsOn: '' }]
  assert.deepEqual(upcomingEvents(events, '2026-10-02').map(e => e.id), ['running', 'open', 'next'])
  assert.deepEqual(newestFirst([{ createdAt: '2026-09-30T05:00:00Z' }, { createdAt: '2026-10-01T05:00:00Z' }]).map(n => n.createdAt.slice(0, 10)), ['2026-10-01', '2026-09-30'])
})

test('fee totals match the web summary: billed is after concessions', () => {
  const totals = feeTotals([charge('1', 12000, 2000, 10000), charge('2', 8000, 0, 3000), charge('3', 5000, 500, 0)])
  assert.deepEqual(totals, { billed: 22500, paid: 13000, balance: 9500, outstanding: 2, count: 3, currency: 'INR' })
  assert.deepEqual(feeTotals([]), { billed: 0, paid: 0, balance: 0, outstanding: 0, count: 0, currency: '' })
  assert.equal(money('INR', 9500), 'INR 9,500.00')
  assert.equal(money('', 12.5), '12.50')
})

test('the register summary reflects unsaved choices, and only real changes are sent', () => {
  const rows = [row('1', 'Present'), row('2', ''), row('3', 'Absent'), row('4', '')]
  assert.deepEqual(registerSummary(rows), { Present: 1, Late: 0, Absent: 1, Excused: 0, unmarked: 2, total: 4 })
  const draft = { '1': 'Present', '2': 'Late', '3': 'Excused' } as const
  assert.deepEqual(registerSummary(rows, draft), { Present: 1, Late: 1, Absent: 0, Excused: 1, unmarked: 1, total: 4 })
  assert.deepEqual(registerChanges(rows, draft), [{ studentId: '2', status: 'Late' }, { studentId: '3', status: 'Excused' }], 'choosing the status already saved is not a change')
  assert.deepEqual(registerChanges(rows, { ghost: 'Present' }), [], 'a student who is not in the register is never sent')
})

test('"mark the rest present" fills only the unmarked and keeps every choice already made', () => {
  const rows = [row('1', 'Absent'), row('2', ''), row('3', '')]
  assert.deepEqual(markRestPresent(rows, { '3': 'Late' }), { '2': 'Present', '3': 'Late' })
  assert.deepEqual(classesOf([row('1', '', '9 - B'), row('2', '', '8 - A'), row('3', '', '9 - B'), row('4', '', '')]), ['8 - A', '9 - B'])
})

test('leave length and date stepping are calendar-correct', () => {
  assert.deepEqual([leaveDays('2026-10-02', '2026-10-02'), leaveDays('2026-10-30', '2026-11-02'), leaveDays('2026-10-05', '2026-10-02'), leaveDays('soon', '2026-10-02')], [1, 4, 0, 0])
  assert.deepEqual([shiftDay('2026-10-31', 1), shiftDay('2026-03-01', -1), shiftDay('2028-02-28', 1)], ['2026-11-01', '2026-02-28', '2028-02-29'])
  assert.deepEqual(recentDays('2026-10-02', 4), ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])
})
