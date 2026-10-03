// Run with `npm run test:unit`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { accountInitials, accountKind, accountName, accountPath } from '../src/pages/account.ts'

test('every account has a name, initials and a kind to show', () => {
  const teacher = { firstName: ' Ravi ', lastName: 'Kumar', username: 'ravi@example.test', roles: ['Teacher'], dataScope: 'teacher' }
  assert.deepEqual([accountName(teacher), accountInitials(teacher), accountKind(teacher)], ['Ravi Kumar', 'RK', 'Teacher'])
  // No name recorded: the sign-in name stands in, and the avatar still has a letter.
  const bare = { username: 'suite.administrator', roles: ['Administrator'] }
  assert.deepEqual([accountName(bare), accountInitials(bare)], ['suite.administrator', 'S'])
  assert.deepEqual([accountName(null), accountInitials(undefined), accountKind(null)], ['Account', 'A', 'Staff'])
  assert.equal(accountInitials({ firstName: 'आशा', lastName: 'वर्मा' }), 'आव')
  assert.equal(accountKind({ roles: ['Teacher', 'Exam Coordinator'] }), 'Teacher · Exam Coordinator')
  assert.equal(accountKind({ roles: [], dataScope: 'platform' }), 'Platform')
})

test('the identity control leads to the page that role can open', () => {
  assert.equal(accountPath({ dataScope: 'platform' }), '/super-admin/account')
  for (const dataScope of ['school', 'teacher', 'parent', 'student', undefined]) assert.equal(accountPath({ dataScope }), '/account')
})
