import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actionsFor, attentionLines, audienceOptions, composeProblems, editableFields, emptyComposition, feedOrder, fromDetail, localValue, priorityOptions, progress, recordBody, scheduleIso, statusTone, whenLabel, type Attention, type Detail, type FeedItem } from '../src/pages/suite/communications.ts'

const leader = { manage: true, schoolWide: true, acknowledge: true }, teacher = { manage: true, schoolWide: false, acknowledge: true }, parent = { manage: false, schoolWide: false, acknowledge: true }
const counts = (over: Partial<Detail['counts']> = {}) => ({ intended: 40, notified: 38, read: 20, acknowledged: 15, failed: 0, outstanding: 25, ...over })

test('each status offers only its own moves, and only to someone who manages communications', () => {
  assert.deepEqual(actionsFor('Draft', leader).map(a => a.action), ['publish', 'schedule', 'cancel'])
  assert.deepEqual(actionsFor('Scheduled', leader).map(a => a.action), ['publish', 'schedule', 'unschedule', 'cancel'])
  assert.deepEqual(actionsFor('Published', leader).map(a => a.action), ['archive'])
  assert.deepEqual(actionsFor('Archived', leader), []); assert.deepEqual(actionsFor('Cancelled', leader), []); assert.deepEqual(actionsFor('Draft', parent), [])
  assert.ok(actionsFor('Draft', leader).find(a => a.action === 'cancel')!.reason); assert.ok(actionsFor('Draft', leader).find(a => a.action === 'schedule')!.time)
  assert.deepEqual(editableFields('Published'), ['title', 'message', 'acknowledgeBy', 'expiresOn']); assert.deepEqual(editableFields('Cancelled'), []); assert.ok(editableFields('Scheduled').includes('audience'))
  assert.equal(statusTone('Published'), 'active'); assert.equal(statusTone('Scheduled'), 'important'); assert.equal(statusTone('Cancelled'), 'muted')
})

test('a teacher is offered only class family audiences and never Urgent', () => {
  assert.deepEqual(audienceOptions(teacher).map(a => a.key), ['Parent', 'Student', 'Family'])
  assert.equal(audienceOptions(leader).length, 6)
  assert.deepEqual(priorityOptions(teacher), ['Normal', 'Important']); assert.deepEqual(priorityOptions(leader), ['Normal', 'Important', 'Urgent'])
})

test('the form is pre-checked before it is sent, in step order', () => {
  const now = new Date('2026-10-06T09:00:00Z')
  assert.deepEqual(composeProblems(emptyComposition(), leader, now), ['Give the communication a title.', 'Write the message.'])
  const ok = { ...emptyComposition(), title: 'Sports day', message: 'Bring water.' }
  assert.deepEqual(composeProblems(ok, leader, now), [])
  assert.deepEqual(composeProblems({ ...ok, audience: 'All', classId: '' }, teacher, now), ['Choose one of your classes.', 'Teachers address the parents or students of a class.'])
  assert.deepEqual(composeProblems({ ...ok, audience: 'Parent', classId: 'c1', priority: 'Urgent' }, teacher, now), ['Only school leadership can send urgent communications.'])
  assert.deepEqual(composeProblems({ ...ok, when: 'schedule' }, leader, now), ['Choose when to publish.'])
  assert.deepEqual(composeProblems({ ...ok, when: 'schedule', publishAt: '2026-10-05T09:00' }, leader, now), ['The publish time must be in the future.'])
  assert.deepEqual(composeProblems({ ...ok, when: 'schedule', publishAt: '2030-10-05T09:00' }, leader, now), [])
})

test('the record the API receives carries the status for the chosen delivery and an ISO publish time only when scheduled', () => {
  const c = { ...emptyComposition(), title: ' Sports day ', message: 'Bring water. ', requiresAcknowledgement: true, acknowledgeBy: '2026-10-20' }
  assert.deepEqual(recordBody(c), { title: 'Sports day', message: 'Bring water.', type: 'Circular', priority: 'Normal', audience: 'All', classId: '', requiresAcknowledgement: 'Yes', dueDate: '2026-10-20', expiresOn: '', status: 'Published', publishAt: '' })
  assert.equal(recordBody({ ...c, when: 'draft' }).status, 'Draft')
  const scheduled = recordBody({ ...c, when: 'schedule', publishAt: '2030-10-07T09:00' })
  assert.equal(scheduled.status, 'Scheduled'); assert.match(scheduled.publishAt, /^2030-10-0[67]T\d\d:\d\d:00\.000Z$/)
  assert.equal(recordBody({ ...c, requiresAcknowledgement: false }).dueDate, '', 'an acknowledge-by date is dropped when no acknowledgement is asked for')
  assert.equal(scheduleIso('nonsense'), ''); assert.equal(localValue(scheduleIso('2030-10-07T09:00')), '2030-10-07T09:00')
})

test('an existing communication opens in the form with its own delivery mode', () => {
  const d = { id: 'x', version: 2, title: 'T', message: 'M', type: 'Alert', priority: 'Urgent', status: 'Scheduled', audience: 'Staff', classId: '', className: '', audienceLabel: 'All staff', publishAt: '2030-10-07T03:30:00Z', publishedAt: '', expiresOn: '', expired: false, requiresAcknowledgement: true, acknowledgeBy: '', authorId: 'u', createdAt: '', counts: counts(), history: [], snapshot: null, cancelReason: '', canUrgent: true } as Detail
  const c = fromDetail(d)
  assert.equal(c.when, 'schedule'); assert.equal(c.audience, 'Staff'); assert.equal(c.requiresAcknowledgement, true); assert.match(c.publishAt, /^2030-10-07T\d\d:\d\d$/)
  assert.equal(fromDetail({ ...d, status: 'Published' }).when, 'now'); assert.equal(fromDetail({ ...d, status: 'Draft', publishAt: '' }).when, 'draft')
})

test('progress and timing read as one line each', () => {
  assert.equal(progress(counts(), true), '20 of 38 read · 15 acknowledged · 25 outstanding')
  assert.equal(progress(counts({ outstanding: null }), false), '20 of 38 read')
  assert.equal(progress(counts({ failed: 2, outstanding: null }), false), '20 of 38 read · 2 delivery failures')
  assert.equal(progress(counts({ failed: 1, outstanding: null }), false), '20 of 38 read · 1 delivery failure')
  assert.equal(whenLabel({ status: 'Draft', publishAt: '', publishedAt: '', expired: false }), 'Not sent yet')
  assert.match(whenLabel({ status: 'Scheduled', publishAt: '2030-10-07T09:00:00Z', publishedAt: '', expired: false }), /^Scheduled for 7 Oct/)
  assert.match(whenLabel({ status: 'Published', publishAt: '', publishedAt: '2026-10-01T09:00:00Z', expired: true }), /^Published 1 Oct.*expired$/)
  assert.equal(whenLabel({ status: 'Cancelled', publishAt: '', publishedAt: '', expired: false }), 'Cancelled')
})

test('the attention summary counts what needs doing and the feed puts outstanding acknowledgements first', () => {
  const item = (over: Record<string, unknown>) => ({ id: 'i', counts: counts(), ...over }) as unknown as Attention['scheduled'][number]
  const a: Attention = { scheduled: [item({}), item({})], recent: [item({})], urgent: [item({})], outstanding: [item({ counts: counts({ outstanding: 25 }) }), item({ counts: counts({ outstanding: 3 }) })], deliveries: { failed: 2, waiting: 0, channels: ['in-app'] } }
  assert.deepEqual(attentionLines(a).map(l => [l.key, l.count]), [['scheduled', 2], ['urgent', 1], ['outstanding', 28], ['failed', 2], ['recent', 1]])
  assert.equal(attentionLines({ ...a, deliveries: { failed: 0, waiting: 0, channels: [] } }).find(l => l.key === 'failed')!.tone, '')
  const feed = (id: string, over: Partial<FeedItem>): FeedItem => ({ id, title: id, message: '', type: 'Circular', priority: 'Normal', audience: 'All', className: '', publishedAt: '2026-10-01T00:00:00Z', expiresOn: '', expired: false, requiresAcknowledgement: false, acknowledgeBy: '', readAt: null, acknowledgedAt: null, canAcknowledge: true, ...over })
  const ordered = feedOrder([feed('old', {}), feed('done', { requiresAcknowledgement: true, acknowledgedAt: '2026-10-02T00:00:00Z', publishedAt: '2026-10-03T00:00:00Z' }), feed('urgent', { priority: 'Urgent' }), feed('todo', { requiresAcknowledgement: true, publishedAt: '2026-09-01T00:00:00Z' }), feed('new', { publishedAt: '2026-10-05T00:00:00Z' })])
  assert.deepEqual(ordered.map(i => i.id), ['todo', 'urgent', 'new', 'done', 'old'])
})
