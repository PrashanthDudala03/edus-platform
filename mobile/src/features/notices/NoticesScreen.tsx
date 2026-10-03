import { useState } from 'react'
import { normalizeError } from '@/api/errors'
import { Chips, Header, ListItem, Sheet } from '@/components/blocks'
import { ListScreen } from '@/components/ListScreen'
import { AppText, Badge, Button, Notice } from '@/components/ui'
import { dayParts, dayRange, isoDay } from '@/utils/format'
import { useAcknowledge, useCalendar, useCirculars, useMessages, usePermission } from '../data'
import { newestFirst, upcomingEvents, type Circular } from '../logic'

// Notices: circulars addressed to this person, the school calendar, and direct messages. Each tab is shown only when
// the account may read it. A real notification inbox arrives with the notification service; this is what exists today.
type Item = { id: string, title: string, body: string, meta: string, circular?: Circular }

export function NoticesScreen() {
  const mayCirculars = usePermission('circulars.view'), mayCalendar = usePermission('calendar.view'), mayMessages = usePermission('messages.view'), mayAcknowledge = usePermission('circulars.acknowledge')
  const tabs = [mayCirculars && { key: 'circulars', label: 'Circulars' }, mayCalendar && { key: 'events', label: 'Events' }, mayMessages && { key: 'messages', label: 'Messages' }].filter(Boolean) as { key: string, label: string }[]
  const [tab, setTab] = useState(tabs[0]?.key ?? 'circulars'), [open, setOpen] = useState<Item | null>(null), [acknowledged, setAcknowledged] = useState<string[]>([]), [failure, setFailure] = useState('')
  const circulars = useCirculars(tab === 'circulars'), calendar = useCalendar(tab === 'events'), messages = useMessages(tab === 'messages'), acknowledge = useAcknowledge()
  const source = tab === 'events' ? calendar : tab === 'messages' ? messages : circulars
  const date = (value: string) => dayParts(value)?.label ?? ''
  const items: Item[] | undefined = tab === 'events' ? calendar.data && upcomingEvents(calendar.data, isoDay(new Date())).map(e => ({ id: e.id, title: e.title, body: e.description, meta: dayRange(e.startsOn, e.endsOn) }))
    : tab === 'messages' ? messages.data && newestFirst(messages.data).map(m => ({ id: m.id, title: m.title, body: m.message, meta: date(m.createdAt) }))
    : circulars.data && newestFirst(circulars.data).map(c => ({ id: c.id, title: c.title, body: c.message, meta: date(c.createdAt) + (c.dueDate ? ' · acknowledge by ' + date(c.dueDate) : ''), circular: c }))
  const confirm = () => { if (!open) return; setFailure('')
    acknowledge.mutate(open.id, { onSuccess: () => setAcknowledged(ids => [...ids, open.id]), onError: error => setFailure(normalizeError(error).message) }) }
  return <><ListScreen source={source} items={items} keyOf={item => item.id}
    top={<><Header overline="School" title="Notices" route="/notices" />{tabs.length > 1 && <Chips value={tab} onChange={setTab} options={tabs} />}</>}
    empty={tab === 'events' ? { icon: 'calendar-outline', title: 'No upcoming events', message: 'Dates from the school calendar will appear here.' } : tab === 'messages' ? { icon: 'chatbubble-outline', title: 'No messages', message: 'Messages sent to you by the school will appear here.' } : { icon: 'megaphone-outline', title: 'No circulars', message: 'Circulars addressed to you will appear here.' }}
    row={(item, index, all) => <ListItem icon={tab === 'events' ? 'calendar-outline' : tab === 'messages' ? 'chatbubble-outline' : 'megaphone-outline'} title={item.title} subtitle={item.body} meta={item.meta} last={index === all.length - 1} onPress={() => { setFailure(''); setOpen(item) }}
      trailing={acknowledged.includes(item.id) ? <Badge label="Acknowledged" tone="success" /> : undefined} />} />
    <Sheet visible={!!open} title={open?.title ?? ''} onClose={() => setOpen(null)}
      footer={open?.circular && mayAcknowledge ? (acknowledged.includes(open.id) ? <Notice message="Your acknowledgement was recorded." /> : <Button label="Acknowledge" icon="checkmark" loading={acknowledge.isPending} onPress={confirm} />) : undefined}>
      {open && <><AppText variant="caption" tone="primary">{open.meta}</AppText><AppText>{open.body}</AppText>{!!failure && <Notice tone="danger" message={failure} />}</>}
    </Sheet></>
}
