// Run with `npm run test:unit`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { schoolChoices } from '../src/pages/schoolChoices.ts'

test('only well-formed schools are offered at sign-in', () => {
  const a = 'aeea48a8-f51f-4676-ada6-2435c711714a'
  assert.deepEqual(schoolChoices({ statusCode: 409, schools: [{ id: a, name: ' Riverside School ' }, { id: 'x', name: 'B' }, { id: a, name: '' }, null, 'x', { id: a }] }), [{ id: a, name: 'Riverside School' }])
  for (const nothing of [null, undefined, '', {}, { schools: 'x' }, { schools: {} }]) assert.deepEqual(schoolChoices(nothing), [])
})
