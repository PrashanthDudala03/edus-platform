import test from 'node:test'
import assert from 'node:assert/strict'
import { canOpen } from '../src/access/experience.ts'
import { resolveNotificationRoute } from '../src/notifications/routes.ts'
import type { User } from '../src/session/types.ts'
import { attentionLines, dedupe, feedOrder, needsAction, priorityTone, rowBadge, type CommunicationAttention, type CommunicationItem } from '../src/features/communications.ts'

const person = (dataScope: string, permissions: string[]): User => ({ id: 'u', username: 'u', email: '', firstName: 'A', lastName: 'B', schoolId: 's', roles: ['Role'], permissions, dataScope })
const item = (id: string, over: Partial<CommunicationItem> = {}): CommunicationItem => ({ id, title: id, message: '', type: 'Circular', priority: 'Normal', audience: 'All', className: '', publishedAt: '2026-10-01T00:00:00Z', expiresOn: '', expired: false, requiresAcknowledgement: false, acknowledgeBy: '', readAt: null, acknowledgedAt: null, canAcknowledge: true, ...over })

test('what still wants acknowledging comes first, then urgent, then newest, and a row says what is expected', () => {
  const ordered = feedOrder([item('old'), item('done', { requiresAcknowledgement: true, acknowledgedAt: 'x', publishedAt: '2026-10-03T00:00:00Z' }), item('urgent', { priority: 'Urgent' }), item('todo', { requiresAcknowledgement: true, publishedAt: '2026-09-01T00:00:00Z' }), item('new', { publishedAt: '2026-10-05T00:00:00Z' })])
  assert.deepEqual(ordered.map(i => i.id), ['todo', 'urgent', 'new', 'done', 'old'])
  assert.deepEqual(rowBadge(item('a', { requiresAcknowledgement: true })), { label: 'To acknowledge', tone: 'warning' })
  assert.deepEqual(rowBadge(item('a', { requiresAcknowledgement: true, acknowledgedAt: 'x', priority: 'Urgent' })), { label: 'Acknowledged', tone: 'success' })
  assert.deepEqual(rowBadge(item('a', { priority: 'Urgent' })), { label: 'Urgent', tone: 'danger' })
  assert.deepEqual(rowBadge(item('a', { expired: true })), { label: 'Expired', tone: 'neutral' }); assert.equal(rowBadge(item('a')), null)
  assert.equal(needsAction(item('a', { requiresAcknowledgement: true, readAt: 'x' })), true); assert.equal(needsAction(item('a', { readAt: 'x' })), false); assert.equal(needsAction(item('a')), true)
  assert.equal(priorityTone('Urgent'), 'danger'); assert.equal(priorityTone('Important'), 'warning'); assert.equal(priorityTone('Normal'), 'neutral')
})

test('a parent of two children sees a school-wide communication once', () => {
  assert.deepEqual(dedupe([item('a'), item('b'), item('a')]).map(i => i.id), ['a', 'b'])
})

test('leadership sees only what needs attention, and nobody else can reach the summary', () => {
  const attention = (over: Partial<CommunicationAttention> = {}): CommunicationAttention => ({ scheduled: [], recent: [], urgent: [], outstanding: [], deliveries: { failed: 0, waiting: 0, channels: ['in-app'] }, ...over })
  assert.deepEqual(attentionLines(attention()), [])
  const row = (outstanding: number | null) => ({ id: 'x', title: 'x', audienceLabel: 'x', priority: 'Normal', status: 'Published', counts: { outstanding, failed: 0 } })
  assert.deepEqual(attentionLines(attention({ scheduled: [row(null)], urgent: [row(null)], outstanding: [row(19), row(3)], deliveries: { failed: 2, waiting: 0, channels: ['in-app'] } })).map(l => [l.key, l.count, l.tone]),
    [['scheduled', 1, 'primary'], ['urgent', 1, 'danger'], ['outstanding', 22, 'warning'], ['failed', 2, 'danger']])
})

test('communications stay a Notices screen for every role and a published circular opens there', () => {
  for (const scope of ['parent', 'teacher', 'student', 'school']) assert.equal(canOpen(person(scope, ['circulars.view']), '/notices'), true)
  assert.equal(canOpen(person('parent', ['reports.view']), '/notices'), false, 'no permission, no screen')
  assert.equal(resolveNotificationRoute({ type: 'circular.published', entityId: 'x' }, person('parent', ['circulars.view'])).route, '/notices')
  assert.deepEqual(resolveNotificationRoute({ type: 'circular.published' }, person('parent', [])), { route: '/home', reason: 'not-allowed' })
})
