// Run with `npm run test:unit`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { deliverySummary, insertVariable, sentAt, startingText, statusNote, wordingSource, type Template } from '../src/pages/notifications/templates.ts'

const standard = { title: 'Your leave was approved', body: '{{dateRange}}. {{remark}}' }
const template = (override: Template['channels'][number]['override'], source: 'school' | 'default'): Template => ({
  key: 'leave.approved', event: '', name: 'Leave approved', description: '', category: 'leave', status: 'IMPLEMENTED', sending: true, variables: [],
  channels: [{ channel: 'in-app', available: true, titleMax: 200, bodyMax: 1000, default: standard, override, source }, { channel: 'sms', available: false, titleMax: 60, bodyMax: 160, default: null, override: null, source: 'default' }],
})
const own = { title: 'Leave approved', body: 'Enjoy, {{teacherName}}.', enabled: true, version: 2, updatedAt: '2026-10-02T06:00:00Z' }

test('the editor opens with the wording in force, and keeps a switched-off wording editable', () => {
  assert.deepEqual(startingText(template(null, 'default'), 'in-app'), standard)
  assert.deepEqual(startingText(template(own, 'school'), 'in-app'), { title: own.title, body: own.body })
  assert.deepEqual(startingText(template({ ...own, enabled: false }, 'default'), 'in-app'), { title: own.title, body: own.body })
  assert.deepEqual(startingText(template(null, 'default'), 'sms'), { title: '', body: '' })
  assert.deepEqual(startingText(template(null, 'default'), 'fax'), { title: '', body: '' })
})

test('the source of the wording is said plainly', () => {
  assert.equal(wordingSource(template(null, 'default'), 'in-app'), 'EduOS default')
  assert.equal(wordingSource(template(own, 'school'), 'in-app'), "Your school's wording")
  assert.equal(wordingSource(template({ ...own, enabled: false }, 'default'), 'in-app'), 'EduOS default (yours is switched off)')
})

test('a detail is added as a placeholder, spaced only when needed', () => {
  assert.equal(insertVariable('', 'teacherName'), '{{teacherName}}')
  assert.equal(insertVariable('Dear', 'teacherName'), 'Dear {{teacherName}}')
  assert.equal(insertVariable('Dear ', 'teacherName'), 'Dear {{teacherName}}')
})

test('delivery history reads plainly', () => {
  assert.equal(deliverySummary({ failed: 0, waiting: 0 }), 'Delivered')
  assert.equal(deliverySummary({ failed: 0, waiting: 3 }), '3 waiting')
  assert.equal(deliverySummary({ failed: 2, waiting: 0 }), '2 failed')
  assert.equal(deliverySummary({ failed: 2, waiting: 1 }), '2 failed, 1 waiting')
  assert.equal(sentAt('2026-10-02T03:35:00Z', 'Asia/Kolkata'), '2 Oct 2026, 09:05')
  assert.equal(sentAt('nonsense'), '')
})

test('an event EduOS does not raise yet says so', () => {
  assert.equal(statusNote(template(null, 'default')), '')
  assert.match(statusNote({ ...template(null, 'default'), sending: false, status: 'BLOCKED BY DOMAIN EVENT' }), /cannot send this notification yet/)
  assert.match(statusNote({ ...template(null, 'default'), sending: false, status: 'READY FOR PRODUCER' }), /does not send this notification yet/)
})
