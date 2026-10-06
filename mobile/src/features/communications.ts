// Communication 2.0 on the phone: the shapes the feed and summary endpoints return, and the pure logic the Notices
// screen uses, tested with node:test. The server decides who receives what and records every read and acknowledgement.
export interface CommunicationItem { id: string, title: string, message: string, type: string, priority: string, audience: string, className: string, publishedAt: string, expiresOn: string, expired: boolean, requiresAcknowledgement: boolean, acknowledgeBy: string, readAt: string | null, acknowledgedAt: string | null, canAcknowledge: boolean }
export interface CommunicationFeed { items: CommunicationItem[], total: number, acknowledgementsDue: number }
export interface AttentionItem { id: string, title: string, audienceLabel: string, priority: string, status: string, counts: { outstanding: number | null, failed: number } }
export interface CommunicationAttention { scheduled: AttentionItem[], recent: AttentionItem[], urgent: AttentionItem[], outstanding: AttentionItem[], deliveries: { failed: number, waiting: number, channels: string[] } }

export const priorityTone = (priority: string) => priority === 'Urgent' ? 'danger' as const : priority === 'Important' ? 'warning' as const : 'neutral' as const
/** Something the reader still has to do with it: acknowledge where asked, or simply open it. */
export const needsAction = (item: Pick<CommunicationItem, 'requiresAcknowledgement' | 'acknowledgedAt' | 'readAt'>) => item.requiresAcknowledgement ? !item.acknowledgedAt : !item.readAt
/** What still wants acknowledging first, then urgent, then newest. */
export const feedOrder = (items: CommunicationItem[]) => [...items].sort((a, b) =>
  Number(b.requiresAcknowledgement && !b.acknowledgedAt) - Number(a.requiresAcknowledgement && !a.acknowledgedAt) || Number(b.priority === 'Urgent') - Number(a.priority === 'Urgent') || String(b.publishedAt).localeCompare(String(a.publishedAt)))
/** The badge beside a row, if any: acknowledgement state first, then an unusual priority. */
export function rowBadge(item: Pick<CommunicationItem, 'requiresAcknowledgement' | 'acknowledgedAt' | 'priority' | 'expired'>): { label: string, tone: 'neutral' | 'success' | 'warning' | 'danger' | 'primary' } | null {
  if (item.requiresAcknowledgement) return item.acknowledgedAt ? { label: 'Acknowledged', tone: 'success' } : { label: 'To acknowledge', tone: 'warning' }
  if (item.priority === 'Urgent') return { label: 'Urgent', tone: 'danger' }
  if (item.expired) return { label: 'Expired', tone: 'neutral' }
  return null
}
/** The leadership summary as short lines: only what needs attention, with its count. */
export function attentionLines(a: CommunicationAttention): { key: string, label: string, count: number, tone: 'neutral' | 'warning' | 'danger' | 'primary' }[] {
  const outstanding = a.outstanding.reduce((n, i) => n + (i.counts.outstanding ?? 0), 0)
  const lines: { key: string, label: string, count: number, tone: 'neutral' | 'warning' | 'danger' | 'primary' }[] = [
    { key: 'scheduled', label: 'scheduled to go out', count: a.scheduled.length, tone: 'primary' },
    { key: 'urgent', label: 'urgent and live', count: a.urgent.length, tone: a.urgent.length ? 'danger' : 'neutral' },
    { key: 'outstanding', label: 'acknowledgements outstanding', count: outstanding, tone: outstanding ? 'warning' : 'neutral' },
    { key: 'failed', label: 'delivery failures this week', count: a.deliveries.failed, tone: a.deliveries.failed ? 'danger' : 'neutral' },
  ]
  return lines.filter(line => line.count > 0)
}
/** A multi-child parent sees a school-wide communication once; the server already sends one per account, so the app never duplicates rows by child. */
export const dedupe = (items: CommunicationItem[]) => items.filter((item, i, all) => all.findIndex(other => other.id === item.id) === i)
