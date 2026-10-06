import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ago, categoryLabel, destinationPath, unreadBadge } from '../src/pages/notifications/inbox.ts'

const id = '7c1d0000-0000-4000-8000-0000000000d1'

test('a notification opens the first page the account may visit, never one it may not, and an unknown key goes home', () => {
  const parent = (path: string) => ['/suite/reports', '/suite/homework', '/suite/marks', '/suite/fees', '/suite/communications', '/home'].includes(path)
  const teacher = (path: string) => ['/suite/register', '/suite/homework', '/suite/leave-requests', '/suite/timetable', '/suite/communications'].includes(path)
  assert.equal(destinationPath({ route: 'attendance' }, parent), '/suite/reports')
  assert.equal(destinationPath({ route: 'attendance' }, teacher), '/suite/register')
  assert.equal(destinationPath({ route: 'results', entityId: id }, parent), '/suite/marks')
  assert.equal(destinationPath({ route: 'results' }, teacher), '/', 'no permitted page')
  assert.equal(destinationPath({ route: 'leave' }, teacher), '/suite/leave-requests')
  assert.equal(destinationPath({ route: 'notices', entityId: id }, parent), '/suite/communications?open=' + id)
  assert.equal(destinationPath({ route: 'notices', entityId: '<script>' }, parent), '/suite/communications', 'only a record id is carried')
  assert.equal(destinationPath({ route: 'payroll' }, () => true), '/'); assert.equal(destinationPath(null, () => true), '/')
  assert.equal(destinationPath({ route: 'home' }, () => true), '/')
})

test('badge, category and time read naturally', () => {
  assert.equal(unreadBadge(0), ''); assert.equal(unreadBadge(7), '7'); assert.equal(unreadBadge(250), '99+')
  assert.equal(categoryLabel('fees'), 'Fees'); assert.equal(categoryLabel('unknown'), 'EduOS')
  const now = new Date('2026-10-02T12:00:00Z')
  assert.deepEqual(['2026-10-02T11:59:40Z', '2026-10-02T11:15:00Z', '2026-10-02T07:00:00Z', '2026-09-29T12:00:00Z', '2026-09-01T12:00:00Z', 'nonsense'].map(v => ago(v, now)), ['Just now', '45 min ago', '5 h ago', '3 d ago', '1 Sep 2026', ''])
})
