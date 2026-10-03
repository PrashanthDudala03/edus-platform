import { useState } from 'react'
import { Pressable, StyleSheet, Switch, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { normalizeError } from '@/api/errors'
import { Group, Header, LinkText, ListItem, Sheet } from '@/components/blocks'
import { ListScreen } from '@/components/ListScreen'
import { AppText, EmptyState, Screen, type IconName } from '@/components/ui'
import { resolveNotificationRoute } from '@/notifications/routes'
import { api, useSession } from '@/services'
import { color, radius, space } from '@/theme/tokens'
import { ago } from '@/utils/format'

// The Notification Centre: this person's inbox from the EduOS notification engine. The server decides who receives
// what; the app only reads the caller's own inbox, marks items read and opens the screen a notification points to,
// after checking the signed-in account may open it.
export interface AppNotification { id: string, type: string, category: string, title: string, body: string, createdAt: string, readAt: string | null }
interface Inbox { items: AppNotification[], unread: number, totalCount: number }
interface Preferences { categories: string[], channels: { key: string, available: boolean }[], disabled: { category: string, channel: string }[] }

const CATEGORY: Record<string, { label: string, icon: IconName }> = {
  attendance: { label: 'Attendance', icon: 'calendar-outline' }, homework: { label: 'Homework', icon: 'book-outline' }, results: { label: 'Results', icon: 'ribbon-outline' }, fees: { label: 'Fees', icon: 'wallet-outline' },
  notices: { label: 'Notices', icon: 'megaphone-outline' }, leave: { label: 'Leave', icon: 'document-text-outline' }, timetable: { label: 'Timetable', icon: 'time-outline' }, school: { label: 'School', icon: 'school-outline' },
}
const category = (key: string) => CATEGORY[key] ?? { label: 'EduOS', icon: 'notifications-outline' as IconName }
/** A server that does not have the notification engine yet answers 403 or 404; that is "not switched on", not an error. */
const notEnabled = (error: unknown) => ['forbidden', 'not-found'].includes(normalizeError(error).kind)

export function useUnreadCount() {
  const signedIn = useSession(state => state.status === 'signed-in')
  return useQuery({ queryKey: ['notifications', 'unread'], enabled: signedIn, retry: false, refetchInterval: 60_000, queryFn: async () => Number(((await api.get('/notifications/unread-count')).data.data as { unread: number }).unread) || 0 })
}
/** The bell: opens the Notification Centre and shows how many are unread. It stays quiet when the engine is not available. */
export function NotificationBell({ tint = color.text }: { tint?: string }) {
  const router = useRouter(), unread = useUnreadCount().data ?? 0
  return <Pressable accessibilityRole="button" accessibilityLabel={unread ? `Notifications, ${unread} unread` : 'Notifications'} hitSlop={8} onPress={() => router.navigate('/notifications')} style={({ pressed }) => [styles.bell, pressed && styles.pressed]}>
    <Ionicons name="notifications-outline" size={24} color={tint} />
    {unread > 0 && <View style={styles.badge}><AppText variant="caption" tone="inverse" style={styles.badgeText}>{unread > 99 ? '99+' : unread}</AppText></View>}</Pressable>
}

export function NotificationsScreen() {
  const router = useRouter(), cache = useQueryClient(), user = useSession(state => state.user), [settings, setSettings] = useState(false), [failure, setFailure] = useState('')
  const inbox = useQuery({ queryKey: ['notifications', 'inbox'], retry: false, queryFn: async (): Promise<Inbox> => { const data = (await api.get('/notifications', { params: { page: 1 } })).data.data as Inbox; return { items: data.items ?? [], unread: Number(data.unread) || 0, totalCount: Number(data.totalCount) || 0 } } })
  const preferences = useQuery({ queryKey: ['notifications', 'preferences'], enabled: settings, retry: false, queryFn: async () => (await api.get('/notifications/preferences')).data.data as Preferences })
  const refresh = () => cache.invalidateQueries({ queryKey: ['notifications'] })
  const read = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSettled: refresh })
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSettled: refresh })
  const prefer = useMutation({ mutationFn: (input: { category: string, enabled: boolean }) => api.put('/notifications/preferences', { ...input, channel: 'in-app' }), onError: error => setFailure(normalizeError(error).message), onSettled: () => cache.invalidateQueries({ queryKey: ['notifications', 'preferences'] }) })
  const open = (item: AppNotification) => { if (!item.readAt) read.mutate(item.id); router.navigate(resolveNotificationRoute({ type: item.type }, user).route) }

  if (inbox.isError && notEnabled(inbox.error)) return <Screen><Header overline="Inbox" title="Notifications" route="/notifications" />
    <EmptyState icon="notifications-off-outline" title="Notifications are not switched on yet" message="Your school’s EduOS has not enabled the notification inbox on this server yet. Nothing has been missed; notices and circulars are in Notices." /></Screen>
  const muted = (key: string) => !!preferences.data?.disabled.some(entry => entry.category === key && entry.channel === 'in-app')
  return <><ListScreen source={inbox} items={inbox.data?.items} keyOf={item => item.id}
    top={<><Header overline="Inbox" title="Notifications" route="/notifications" right={<Pressable accessibilityRole="button" accessibilityLabel="Notification settings" hitSlop={10} onPress={() => { setFailure(''); setSettings(true) }}><Ionicons name="options-outline" size={22} color={color.text} /></Pressable>} />
      {!!inbox.data?.unread && <View style={styles.bar}><AppText variant="label" tone="muted">{inbox.data.unread} unread</AppText><LinkText label="Mark all as read" onPress={() => readAll.mutate()} /></View>}</>}
    empty={{ icon: 'notifications-outline', title: 'You are all caught up', message: 'New circulars, leave decisions and other updates from your school will appear here.' }}
    row={(item, index, all) => <ListItem leading={<View style={[styles.icon, !item.readAt && styles.iconUnread]}><Ionicons name={category(item.category).icon} size={19} color={item.readAt ? color.textMuted : color.primary} /></View>}
      title={item.title} subtitle={item.body} meta={`${category(item.category).label} · ${ago(item.createdAt, new Date())}`} onPress={() => open(item)} last={index === all.length - 1}
      trailing={item.readAt ? undefined : <View accessibilityLabel="Unread" style={styles.dot} />} />} />
    <Sheet visible={settings} title="Notification settings" onClose={() => setSettings(false)}>
      <AppText tone="muted">Choose what appears in your inbox. Switching one off stops new notifications of that kind for you only.</AppText>
      <Group>{(preferences.data?.categories ?? Object.keys(CATEGORY)).map((key, i, all) => <ListItem key={key} icon={category(key).icon} title={category(key).label} last={i === all.length - 1}
        trailing={<Switch accessibilityLabel={category(key).label + ' notifications'} disabled={!preferences.data || prefer.isPending} value={!muted(key)} onValueChange={enabled => { setFailure(''); prefer.mutate({ category: key, enabled }) }} trackColor={{ true: color.primary, false: color.border }} thumbColor="#ffffff" />} />)}</Group>
      {!!failure && <AppText variant="caption" tone="danger">{failure}</AppText>}
      <AppText variant="caption" tone="faint">Push alerts, email, WhatsApp and SMS are not available yet. Only the in-app inbox is active.</AppText>
    </Sheet></>
}
const styles = StyleSheet.create({
  pressed: { opacity: 0.6 }, bell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 4, right: 2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: color.danger, alignItems: 'center', justifyContent: 'center' }, badgeText: { fontSize: 10, lineHeight: 12, fontWeight: '700' },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  icon: { width: 38, height: 38, borderRadius: radius.md, backgroundColor: color.surfaceMuted, alignItems: 'center', justifyContent: 'center' }, iconUnread: { backgroundColor: color.successSurface },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.primary, marginLeft: space.xs },
})
