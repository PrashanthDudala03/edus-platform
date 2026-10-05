import test from 'node:test'
import assert from 'node:assert/strict'
import { canOpen, navigationFor } from '../src/access/experience.ts'
import type { User } from '../src/session/types.ts'
import { admissionGroup, admissionTone, mobileDecisions } from '../src/features/admissions.ts'

const person = (dataScope: string, permissions: string[]): User => ({ id: 'u', username: 'u', email: '', firstName: 'A', lastName: 'B', schoolId: 's', roles: ['Role'], permissions, dataScope })

test('admissions on the phone are a leadership screen, never a family or teacher one', () => {
  assert.ok(navigationFor(person('school', ['admissions.view'])).some(e => e.route === '/admissions'))
  assert.equal(canOpen(person('school', ['admissions.view']), '/admissions'), true)
  assert.equal(canOpen(person('school', []), '/admissions'), false, 'leadership scope without the permission')
  for (const scope of ['parent', 'student', 'teacher']) assert.equal(canOpen(person(scope, ['admissions.view', 'admissions.approve']), '/admissions'), false, scope + ' never reaches admissions')
})

test('applications are grouped by what needs doing and decisions follow permissions', () => {
  assert.deepEqual(['Submitted', 'Under Review', 'Waitlisted', 'Approved', 'Onboarding', 'Ready', 'Active', 'Rejected'].map(admissionGroup), ['Decide', 'Decide', 'Decide', 'Onboarding', 'Onboarding', 'Onboarding', 'Done', 'Done'])
  assert.deepEqual(mobileDecisions('Under Review', { approve: true, manage: false }).map(d => d.to), ['Approved', 'Waitlisted', 'Rejected'])
  assert.deepEqual(mobileDecisions('Under Review', { approve: false, manage: true }).map(d => d.to), [])
  assert.deepEqual(mobileDecisions('Submitted', { approve: false, manage: true }).map(d => d.to), ['Under Review'])
  assert.deepEqual(mobileDecisions('Approved', { approve: true, manage: true }), [], 'onboarding and activation stay on the web')
  assert.ok(mobileDecisions('Under Review', { approve: true, manage: true }).filter(d => d.to !== 'Approved').every(d => d.reason))
  assert.equal(admissionTone('Ready'), 'success'); assert.equal(admissionTone('Waitlisted'), 'warning')
})
