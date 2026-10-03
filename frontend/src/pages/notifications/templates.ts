// Notification wording, as the notification service describes it. Pure helpers only, so they are unit tested.
export type Wording = { title: string, body: string }
export type TemplateChannel = { channel: string, available: boolean, titleMax: number, bodyMax: number, default: Wording | null, override: (Wording & { enabled: boolean, version: number, updatedAt: string }) | null, source: 'school' | 'default' }
export type Template = { key: string, event: string, name: string, description: string, category: string, status: string, sending: boolean, variables: { name: string, description: string, sample: string }[], channels: TemplateChannel[] }

export const CHANNEL_LABELS: Record<string, string> = { 'in-app': 'In-app inbox (web and mobile)', push: 'Push notification', email: 'Email', whatsapp: 'WhatsApp', sms: 'SMS' }

const channelOf = (template: Template, channel: string) => template.channels.find(c => c.channel === channel)
/** What the editor opens with: the school's own wording when it has any (even when switched off), otherwise the EduOS default. */
export function startingText(template: Template, channel: string): Wording {
  const found = channelOf(template, channel), text = found?.override ?? found?.default
  return { title: text?.title ?? '', body: text?.body ?? '' }
}
/** Which wording is in force for a channel, in words. */
export function wordingSource(template: Template, channel: string): string {
  const found = channelOf(template, channel)
  return found?.source === 'school' ? "Your school's wording" : found?.override ? 'EduOS default (yours is switched off)' : 'EduOS default'
}
/** What the event's status means for a school administrator. */
export function statusNote(template: Template): string {
  return template.sending ? '' : template.status === 'BLOCKED BY DOMAIN EVENT'
    ? "EduOS cannot send this notification yet. You can prepare your school's wording now; nothing is sent until it is switched on."
    : "EduOS does not send this notification yet. You can prepare your school's wording now; nothing is sent until it is switched on."
}
export type HistoryItem = { id: string, type: string, template: string | null, category: string, title: string, wording: string, wordingVersion: number | null, createdAt: string, recipients: number, read: number, failed: number, waiting: number }
export type HistoryPage = { items: HistoryItem[], totalCount: number, page: number, pageSize: number }
export type HistoryDetail = { notification: HistoryItem, recipients: { name: string, scope: string, read: boolean, channel: string | null, status: string | null, attempts: number | null, lastError: string | null }[] }
/** One line saying what the channels did with a notification. */
export function deliverySummary(item: Pick<HistoryItem, 'failed' | 'waiting'>): string {
  return item.failed > 0 ? item.failed + ' failed' + (item.waiting > 0 ? ', ' + item.waiting + ' waiting' : '') : item.waiting > 0 ? item.waiting + ' waiting' : 'Delivered'
}
/** A sent time as "2 Oct 2026, 09:05" in the viewer's own time zone; empty when it cannot be read. */
export function sentAt(value: string, zone?: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zone }).format(date)
}
/** Adds a placeholder to the end of a field, with a space when one is needed. */
export function insertVariable(text: string, name: string): string {
  return text + (text === '' || /\s$/.test(text) ? '' : ' ') + '{{' + name + '}}'
}
