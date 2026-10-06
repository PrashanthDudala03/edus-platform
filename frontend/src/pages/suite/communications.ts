// Communication 2.0 presentation helpers, kept free of React so they are unit tested. The server decides every status,
// audience and figure; these only arrange and word what it returns, and pre-check a form before it is sent.
export type Status = 'Draft' | 'Scheduled' | 'Published' | 'Archived' | 'Cancelled'
export type Counts = { intended: number, notified: number, read: number, acknowledged: number, failed: number, outstanding: number | null }
export type Item = { id: string, version: number, title: string, type: string, priority: string, status: Status, audience: string, classId: string, className: string, audienceLabel: string, publishAt: string, publishedAt: string, expiresOn: string, expired: boolean, requiresAcknowledgement: boolean, acknowledgeBy: string, authorId: string, createdAt: string, counts: Counts }
export type HistoryEntry = { from: string, to: string, by: string, at: string, reason: string }
export type Detail = Item & { message: string, history: HistoryEntry[], snapshot: { count: number, at: string, audience: string } | null, cancelReason: string, canUrgent: boolean }
export type Workspace = { items: Item[], counts: Record<Status, number>, total: number, page: number, pageSize: number, canUrgent: boolean, schoolWide: boolean }
export type FeedItem = { id: string, title: string, message: string, type: string, priority: string, audience: string, className: string, publishedAt: string, expiresOn: string, expired: boolean, requiresAcknowledgement: boolean, acknowledgeBy: string, readAt: string | null, acknowledgedAt: string | null, canAcknowledge: boolean }
export type Feed = { items: FeedItem[], total: number, page: number, pageSize: number, acknowledgementsDue: number }
export type Attention = { scheduled: Item[], recent: Item[], urgent: Item[], outstanding: Item[], deliveries: { failed: number, waiting: number, channels: string[] } }
export type Acknowledgements = { acknowledged: { name: string, scope: string, at: string }[], outstanding: { name: string, scope: string, read: boolean }[], intended: number, requiresAcknowledgement: boolean }
export type Perms = { manage: boolean, schoolWide: boolean, acknowledge: boolean }
export type Composition = { title: string, message: string, type: string, priority: string, audience: string, classId: string, requiresAcknowledgement: boolean, acknowledgeBy: string, expiresOn: string, when: 'now' | 'schedule' | 'draft', publishAt: string }

export const STATUSES: Status[] = ['Draft', 'Scheduled', 'Published', 'Archived', 'Cancelled']
export const TYPES = ['Circular', 'Notice', 'Announcement', 'Alert', 'Event']
export const PRIORITIES = ['Normal', 'Important', 'Urgent']
export const AUDIENCES: { key: string, label: string }[] = [
  { key: 'All', label: 'Whole school' }, { key: 'Staff', label: 'All staff (leadership and teachers)' }, { key: 'Teacher', label: 'Teachers' },
  { key: 'Parent', label: 'Parents' }, { key: 'Student', label: 'Students' }, { key: 'Family', label: 'Parents and students' },
]
/** What a teacher may address: the families of one of their classes. */
export const TEACHER_AUDIENCES = ['Parent', 'Student', 'Family']
export const STEPS = ['Message', 'Audience', 'Delivery', 'Review'] as const

export const statusTone = (s: string) => s === 'Published' ? 'active' : s === 'Scheduled' ? 'important' : s === 'Archived' || s === 'Cancelled' ? 'muted' : ''
export const priorityTone = (p: string) => p === 'Urgent' ? 'urgent' : p === 'Important' ? 'important' : ''
export const audienceOptions = (p: Pick<Perms, 'schoolWide'>) => p.schoolWide ? AUDIENCES : AUDIENCES.filter(a => TEACHER_AUDIENCES.includes(a.key))
export const priorityOptions = (p: Pick<Perms, 'schoolWide'>) => p.schoolWide ? PRIORITIES : PRIORITIES.filter(x => x !== 'Urgent')

/** The status moves a person may make from here; the server checks them again. */
export function actionsFor(status: string, p: Pick<Perms, 'manage'>): { action: string, label: string, reason?: boolean, primary?: boolean, time?: boolean }[] {
  if (!p.manage) return []
  if (status === 'Draft') return [{ action: 'publish', label: 'Publish now', primary: true }, { action: 'schedule', label: 'Schedule', time: true }, { action: 'cancel', label: 'Cancel', reason: true }]
  if (status === 'Scheduled') return [{ action: 'publish', label: 'Publish now', primary: true }, { action: 'schedule', label: 'Change time', time: true }, { action: 'unschedule', label: 'Back to draft' }, { action: 'cancel', label: 'Cancel', reason: true }]
  if (status === 'Published') return [{ action: 'archive', label: 'Archive' }]
  return []
}
/** Which fields may still change: everything before publication; wording, expiry and the acknowledge-by date after it; nothing once closed. */
export const editableFields = (status: string): string[] =>
  status === 'Draft' || status === 'Scheduled' ? ['title', 'message', 'type', 'priority', 'audience', 'classId', 'requiresAcknowledgement', 'acknowledgeBy', 'expiresOn']
  : status === 'Published' ? ['title', 'message', 'acknowledgeBy', 'expiresOn'] : []

export const emptyComposition = (): Composition => ({ title: '', message: '', type: 'Circular', priority: 'Normal', audience: 'All', classId: '', requiresAcknowledgement: false, acknowledgeBy: '', expiresOn: '', when: 'now', publishAt: '' })
/** A datetime-local value (the person's own clock) as the ISO instant the server stores. */
export const scheduleIso = (local: string) => { const d = new Date(local); return Number.isNaN(d.getTime()) ? '' : d.toISOString() }
/** An ISO instant as a datetime-local value, for editing. */
export function localValue(iso: string): string {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}
/** Why the form cannot be sent yet, in the order the steps appear. The server validates everything again. */
export function composeProblems(c: Composition, p: Pick<Perms, 'schoolWide'>, now = new Date()): string[] {
  const problems: string[] = []
  if (!c.title.trim()) problems.push('Give the communication a title.')
  if (!c.message.trim()) problems.push('Write the message.')
  if (!p.schoolWide && !c.classId) problems.push('Choose one of your classes.')
  if (!p.schoolWide && !TEACHER_AUDIENCES.includes(c.audience)) problems.push('Teachers address the parents or students of a class.')
  if (c.priority === 'Urgent' && !p.schoolWide) problems.push('Only school leadership can send urgent communications.')
  if (c.when === 'schedule') { const at = new Date(c.publishAt); if (!c.publishAt || Number.isNaN(at.getTime())) problems.push('Choose when to publish.'); else if (at <= now) problems.push('The publish time must be in the future.') }
  return problems
}
/** The record the API saves, from the form. */
export function recordBody(c: Composition): Record<string, string> {
  return { title: c.title.trim(), message: c.message.trim(), type: c.type, priority: c.priority, audience: c.audience, classId: c.classId, requiresAcknowledgement: c.requiresAcknowledgement ? 'Yes' : 'No', dueDate: c.requiresAcknowledgement ? c.acknowledgeBy : '', expiresOn: c.expiresOn,
    status: c.when === 'now' ? 'Published' : c.when === 'schedule' ? 'Scheduled' : 'Draft', publishAt: c.when === 'schedule' ? scheduleIso(c.publishAt) : '' }
}
export const fromDetail = (d: Detail): Composition => ({ title: d.title, message: d.message, type: d.type, priority: d.priority, audience: d.audience, classId: d.classId, requiresAcknowledgement: d.requiresAcknowledgement, acknowledgeBy: d.acknowledgeBy, expiresOn: d.expiresOn, when: d.status === 'Scheduled' ? 'schedule' : d.status === 'Published' ? 'now' : 'draft', publishAt: d.publishAt ? localValue(d.publishAt) : '' })

/** One line on what happened to a communication: who was told, read, acknowledged, still outstanding. */
export function progress(c: Counts, requiresAcknowledgement: boolean): string {
  const parts = [c.read + ' of ' + c.notified + ' read']
  if (requiresAcknowledgement) parts.push(c.acknowledged + ' acknowledged', (c.outstanding ?? 0) + ' outstanding')
  if (c.failed > 0) parts.push(c.failed + ' delivery failure' + (c.failed === 1 ? '' : 's'))
  return parts.join(' · ')
}
export const shortWhen = (iso: string) => { const d = new Date(iso); return iso && !Number.isNaN(d.getTime()) ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(d) : '—' }
/** When it was or will be given to its audience. */
export const whenLabel = (i: Pick<Item, 'status' | 'publishAt' | 'publishedAt' | 'expired'>) =>
  i.status === 'Scheduled' ? 'Scheduled for ' + shortWhen(i.publishAt) : i.status === 'Published' ? 'Published ' + shortWhen(i.publishedAt) + (i.expired ? ' · expired' : '') : i.status === 'Draft' ? 'Not sent yet' : i.status
/** The leadership summary as plain lines: what needs attention, nothing more. */
export function attentionLines(a: Attention): { key: string, label: string, count: number, tone: string }[] {
  return [
    { key: 'scheduled', label: 'Scheduled to go out', count: a.scheduled.length, tone: 'important' },
    { key: 'urgent', label: 'Urgent and live', count: a.urgent.length, tone: 'urgent' },
    { key: 'outstanding', label: 'Awaiting acknowledgement', count: a.outstanding.reduce((n, i) => n + (i.counts.outstanding ?? 0), 0), tone: 'important' },
    { key: 'failed', label: 'Delivery failures (7 days)', count: a.deliveries.failed, tone: a.deliveries.failed ? 'urgent' : '' },
    { key: 'recent', label: 'Published this week', count: a.recent.length, tone: 'active' },
  ]
}
/** Feed rows that still want something from the reader, first. */
export const feedOrder = (items: FeedItem[]) => [...items].sort((a, b) => Number(!!b.requiresAcknowledgement && !b.acknowledgedAt) - Number(!!a.requiresAcknowledgement && !a.acknowledgedAt) || Number(b.priority === 'Urgent') - Number(a.priority === 'Urgent') || b.publishedAt.localeCompare(a.publishedAt))
