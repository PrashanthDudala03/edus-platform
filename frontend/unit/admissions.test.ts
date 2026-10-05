import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decisionsFor, editable, docProgress, nextStep, percent, hiddenPassword, answerValue, choices, statusTone, TABS, type Step } from '../src/pages/suite/admissions.ts'

const office = { manage: true, approve: false, onboard: true }, principal = { manage: false, approve: true, onboard: false }, both = { manage: true, approve: true, onboard: true }
const to = (status: string, p: typeof both) => decisionsFor(status, p).map(d => d.to)

test('each person sees only the decisions their permissions allow from the current status', () => {
  assert.deepEqual(to('Draft', office), ['Submitted', 'Withdrawn']); assert.deepEqual(to('Draft', principal), [])
  assert.deepEqual(to('Submitted', principal), ['Under Review', 'Rejected']); assert.deepEqual(to('Submitted', office), ['Under Review', 'Withdrawn'])
  assert.deepEqual(to('Under Review', principal), ['Approved', 'Waitlisted', 'Rejected']); assert.deepEqual(to('Under Review', office), ['Withdrawn'])
  assert.deepEqual(to('Waitlisted', both), ['Approved', 'Under Review', 'Rejected', 'Withdrawn'])
  assert.deepEqual(to('Approved', principal), []); assert.deepEqual(to('Active', both), []); assert.deepEqual(to('Rejected', both), [])
  assert.ok(decisionsFor('Under Review', both).filter(d => d.to === 'Rejected' || d.to === 'Waitlisted').every(d => d.reason))
  assert.equal(editable('Onboarding'), true); assert.equal(editable('Active'), false); assert.equal(editable('Withdrawn'), false)
  assert.equal(statusTone('Ready'), 'active'); assert.equal(statusTone('Rejected'), 'muted'); assert.equal(TABS[0], 'All')
})

test('the checklist points to the next required step, then accounts, then review', () => {
  const step = (key: string, done: boolean, required = true): Step => ({ key, label: key, done, required, detail: '' })
  assert.equal(nextStep([step('details', true), step('guardian', false), step('documents', false)]), 'guardian')
  assert.equal(nextStep([step('details', true), step('guardian', true), step('accounts', false, false)]), 'accounts')
  assert.equal(nextStep([step('details', true), step('accounts', true, false)]), 'review')
  assert.equal(percent({ done: 3, total: 6 }), 50); assert.equal(percent({ done: 0, total: 0 }), 0)
  assert.equal(docProgress({ required: 2, verified: 1 }), '1 of 2 verified'); assert.equal(docProgress({ required: 0, verified: 0 }), 'No documents required')
})

test('a provisioning password is long, random and never reused', () => {
  const a = hiddenPassword(), b = hiddenPassword()
  assert.equal(a.length, 32); assert.notEqual(a, b)
  assert.equal(hiddenPassword(n => new Uint8Array(n)), 'A'.repeat(32))
})

test('form answers are posted in the shape the server validates', () => {
  const form = new FormData(); form.append('answer:langs', 'English'); form.append('answer:langs', 'Tamil'); form.append('answer:consent', 'on'); form.append('answer:blood', ' O+ ')
  assert.deepEqual(answerValue({ key: 'langs', label: 'Languages', type: 'Multiple choice', options: 'English, Tamil', required: false }, form), ['English', 'Tamil'])
  assert.equal(answerValue({ key: 'consent', label: 'Consent', type: 'Checkbox', options: '', required: true }, form), true)
  assert.equal(answerValue({ key: 'photo', label: 'Photo', type: 'Checkbox', options: '', required: false }, form), false)
  assert.equal(answerValue({ key: 'blood', label: 'Blood group', type: 'Dropdown', options: 'O+', required: true }, form), 'O+')
  assert.equal(answerValue({ key: 'none', label: 'None', type: 'Text', options: '', required: false }, form), '')
  assert.deepEqual(choices({ key: 'x', label: 'x', type: 'Dropdown', options: ' A , B,,C ', required: false }), ['A', 'B', 'C'])
})
