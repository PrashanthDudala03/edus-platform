import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { normalizeError } from '@/api/errors'
import { Chips, Header, ListItem, Sheet } from '@/components/blocks'
import { AppText, Badge, Button, Card, Notice } from '@/components/ui'
import { ListScreen } from '@/components/ListScreen'
import { space } from '@/theme/tokens'
import { ago, dayParts, dayRange, isoDay } from '@/utils/format'
import { useAcknowledge, useCalendar, useCommunicationAttention, useCommunicationFeed, useMarkCommunicationRead, useMessages, usePermission } from '../data'
import { newestFirst, upcomingEvents } from '../logic'
import { attentionLines, feedOrder, priorityTone, rowBadge, type CommunicationItem } from '../communications'

// Notices: the communications the school addressed to this person (Communication 2.0), the school calendar, and
// direct messages. Each tab is shown only when the account may read it. Opening a communication records the read;
// acknowledging is recorded once on the server, however many times it is tapped. Leadership sees what needs attention.
type Item = { id: string, title: string, body: string, meta: string, communication?: CommunicationItem }

export function NoticesScreen() {
  const mayCirculars = usePermission('circulars.view'), mayCalendar = usePermission('calendar.view'), mayMessages = usePermission('messages.view')
  const tabs = [mayCirculars && { key: 'circulars', label: 'Communications' }, mayCalendar && { key: 'events', label: 'Events' }, mayMessages && { key: 'messages', label: 'Messages' }].filter(Boolean) as { key: string, label: string }[]
  const [tab, setTab] = useState(tabs[0]?.key ?? 'circulars'), [open, setOpen] = useState<Item | null>(null), [failure, setFailure] = useState('')
  const feed = useCommunicationFeed(tab === 'circulars'), calendar = useCalendar(tab === 'events'), messages = useMessages(tab === 'messages'), attention = useCommunicationAttention(tab === 'circulars')
  const acknowledge = useAcknowledge(), markRead = useMarkCommunicationRead()
  const source = tab === 'events' ? calendar : tab === 'messages' ? messages : feed
  const date = (value: string) => dayParts(value)?.label ?? ''
  const items: Item[] | undefined = tab === 'events' ? calendar.data && upcomingEvents(calendar.data, isoDay(new Date())).map(e => ({ id: e.id, title: e.title, body: e.description, meta: dayRange(e.startsOn, e.endsOn) }))
    : tab === 'messages' ? messages.data && newestFirst(messages.data).map(m => ({ id: m.id, title: m.title, body: m.message, meta: date(m.createdAt) }))
    : feed.data && feedOrder(feed.data.items).map(c => ({ id: c.id, title: c.title, body: c.message, meta: [c.className, ago(c.publishedAt, new Date()), c.acknowledgeBy ? 'acknowledge by ' + date(c.acknowledgeBy) : '', c.expired ? 'expired' : ''].filter(Boolean).join(' · '), communication: c }))
  // The sheet shows the server's current state for the open communication, so an acknowledgement tick is never only local.
  const current = open?.communication && feed.data?.items.find(c => c.id === open.id)
  useEffect(() => { if (current && !current.readAt && !markRead.isPending) markRead.mutate(current.id) }, [current?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const confirm = () => { if (!current) return; setFailure(''); acknowledge.mutate(current.id, { onError: error => setFailure(normalizeError(error).message) }) }
  const lines = attention.data ? attentionLines(attention.data) : []
  return <><ListScreen source={source} items={items} keyOf={item => item.id}
    top={<><Header overline="School" title="Notices" route="/notices" />{tabs.length > 1 && <Chips value={tab} onChange={setTab} options={tabs} />}
      {tab === 'circulars' && lines.length > 0 && <Card label="Communications needing attention" style={styles.attention}><AppText variant="label" tone="muted">Needs attention</AppText>
        {lines.map(line => <View key={line.key} style={styles.line}><Badge label={String(line.count)} tone={line.tone} /><AppText>{line.label}</AppText></View>)}
        <AppText variant="caption" tone="faint">Compose, schedule and the full history are on the web.</AppText></Card>}
      {tab === 'circulars' && !!feed.data?.acknowledgementsDue && <Notice tone="warning" message={feed.data.acknowledgementsDue + ' communication' + (feed.data.acknowledgementsDue === 1 ? '' : 's') + ' waiting for your acknowledgement.'} />}</>}
    empty={tab === 'events' ? { icon: 'calendar-outline', title: 'No upcoming events', message: 'Dates from the school calendar will appear here.' } : tab === 'messages' ? { icon: 'chatbubble-outline', title: 'No messages', message: 'Messages sent to you by the school will appear here.' } : { icon: 'megaphone-outline', title: 'Nothing yet', message: 'Communications addressed to you will appear here.' }}
    row={(item, index, all) => { const badge = item.communication ? rowBadge(item.communication) : null
      return <ListItem icon={tab === 'events' ? 'calendar-outline' : tab === 'messages' ? 'chatbubble-outline' : 'megaphone-outline'} title={(item.communication && !item.communication.readAt ? '● ' : '') + item.title} subtitle={item.body} meta={item.meta} last={index === all.length - 1} onPress={() => { setFailure(''); setOpen(item) }}
        trailing={badge ? <Badge label={badge.label} tone={badge.tone} /> : undefined} /> }} />
    <Sheet visible={!!open} title={open?.title ?? ''} onClose={() => setOpen(null)}
      footer={current?.requiresAcknowledgement ? (current.acknowledgedAt ? <Notice message={'You acknowledged this on ' + date(current.acknowledgedAt.slice(0, 10)) + '.'} /> : current.canAcknowledge ? <Button label="Acknowledge" icon="checkmark" loading={acknowledge.isPending} onPress={confirm} /> : <Notice message="Your account cannot acknowledge communications." />) : undefined}>
      {open && <>{current && <View style={styles.tags}><Badge label={current.type} /><Badge label={current.priority} tone={priorityTone(current.priority)} />{!!current.className && <Badge label={current.className} tone="primary" />}</View>}
        <AppText variant="caption" tone="primary">{open.meta}</AppText><AppText>{open.body}</AppText>{!!failure && <Notice tone="danger" message={failure} />}</>}
    </Sheet></>
}
const styles = StyleSheet.create({ attention: { gap: space.xs }, line: { flexDirection: 'row', alignItems: 'center', gap: space.sm }, tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginBottom: space.xs } })
