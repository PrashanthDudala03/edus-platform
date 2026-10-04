import { useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { experienceFor, navigationFor, type Destination } from '@/access/experience'
import { BUILD_STAMP } from '@/build'
import { Chips, Group, LinkText, ListItem } from '@/components/blocks'
import { AppText, Avatar, Card, Skeleton, type IconName } from '@/components/ui'
import { api, useSession } from '@/services'
import type { User } from '@/session/types'
import { color, elevation, radius, space } from '@/theme/tokens'
import { dayParts, dayRange, greeting, initials, isoDay, percent, weekdayOf } from '@/utils/format'
import { useCalendar, useChildren, useCirculars, useFees, useHomework, useHomeworkBoard, useHomeworkOverview, useLeave, useNames, usePermission, useRegister, useReportCard, useTimetableDay } from '../data'
import { dayRows, periodNote, shownRows } from '../timetable'
import { GROUP_LABEL, feeTotals, money, needsAttention, newestFirst, overviewTotals, registerSummary, splitHomework, upcomingEvents } from '../logic'
import { NotificationBell } from '../notifications/NotificationsScreen'
import { useOverview } from '../principal/OverviewScreen'
import { SchoolImage, useBrand, useSchoolHome } from '../school-home/api'
import { heroOf } from '../school-home/model'
import { useMyClasses } from '../teacher/ClassesScreen'

// Home is each role's command centre. A branded header carries the greeting and one-tap shortcuts; below it the
// role's most important figures sit in a single summary, followed by today, then what is coming up. Every figure
// comes from an existing endpoint; while something loads it shows a dash, and nothing is estimated.
export function useSchoolName() {
  const home = useSchoolHome().data?.home
  const school = useQuery({ queryKey: ['school-name'], enabled: !home, staleTime: 10 * 60_000, queryFn: async () => String(((await api.get('/suite/school')).data.data as { name?: string }).name ?? '') })
  return home?.schoolName || school.data || ''
}
type Go = (route: Destination) => void
const dash = '—'

interface Figure { value: string, label: string, note?: string, warn?: boolean, route: Destination }
/** The role's headline figures in one raised card, so they read as a single summary rather than separate boxes. */
function Summary({ figures, go }: { figures: Figure[], go: Go }) {
  return <View style={styles.summary}>{figures.map((figure, i) => <Pressable key={figure.label} accessibilityRole="button" accessibilityLabel={`${figure.label}: ${figure.value}`} onPress={() => go(figure.route)} style={({ pressed }) => [styles.figure, i > 0 && styles.figureDivider, pressed && styles.pressed]}>
    <AppText variant="title" tone={figure.warn ? 'danger' : 'primary'} numberOfLines={1} adjustsFontSizeToFit>{figure.value}</AppText><AppText variant="label" numberOfLines={1}>{figure.label}</AppText>
    {!!figure.note && <AppText variant="caption" tone="muted" numberOfLines={2}>{figure.note}</AppText>}</Pressable>)}</View>
}
function TodayLessons({ studentId, go, showClass }: { studentId?: string, go: Go, showClass?: boolean }) {
  // The effective day from the timetable endpoint: the role's own scope, with the substitute's name where one takes a lesson.
  const may = usePermission('timetable.view'), day = useTimetableDay(isoDay(new Date()), studentId, may), today = weekdayOf(new Date())
  if (!may) return null
  const rows = day.data ? shownRows(dayRows(day.data.slots, day.data.periods)).filter(r => r.periods.length) : []
  return <Group title={'Today · ' + today} action={<LinkText label="Timetable" onPress={() => go('/timetable')} />}>
    {day.data === undefined ? <View style={styles.pad}><Skeleton width="70%" /></View> : rows.length === 0 ? <ListItem icon="time-outline" title="No lessons today" subtitle={day.data.periods.length === 0 ? 'Nothing is on the timetable for today.' : undefined} last />
      : rows.slice(0, 4).map((row, i, all) => <ListItem key={row.key} leading={<View style={styles.time}><AppText variant="label">{row.startsAt}</AppText><AppText variant="caption" tone="faint">{row.endsAt}</AppText></View>}
        title={row.periods.map(p => p.subjectName || 'Lesson').join(', ')} subtitle={row.periods.map(p => periodNote(p, !!showClass)).join(' · ')} last={i === all.length - 1} />)}</Group>
}
function NoticesPreview({ go }: { go: Go }) {
  const mayCirculars = usePermission('circulars.view'), mayCalendar = usePermission('calendar.view'), circulars = useCirculars(), calendar = useCalendar()
  if (!mayCirculars && !mayCalendar) return null
  const latest = newestFirst(circulars.data ?? []).slice(0, 2), events = upcomingEvents(calendar.data ?? [], isoDay(new Date())).slice(0, 2), rows = latest.length + events.length
  return <Group title="Notices & events" action={<LinkText label="See all" onPress={() => go('/notices')} />}>
    {circulars.data === undefined && calendar.data === undefined ? <View style={styles.pad}><Skeleton width="60%" /></View> : rows === 0 ? <ListItem icon="megaphone-outline" title="Nothing new" subtitle="Circulars and upcoming events appear here." last /> : <>
      {latest.map((notice, i) => <ListItem key={notice.id} icon="megaphone-outline" title={notice.title} subtitle={notice.message} meta={dayParts(notice.createdAt)?.label} onPress={() => go('/notices')} last={i === rows - 1} />)}
      {events.map((event, i) => <ListItem key={event.id} icon="calendar-outline" title={event.title} meta={dayRange(event.startsOn, event.endsOn)} onPress={() => go('/notices')} last={latest.length + i === rows - 1} />)}</>}</Group>
}

function FamilyHome({ student, go }: { student: boolean, go: Go }) {
  const children = useChildren(), [chosen, setChosen] = useState(''), child = children.data?.find(c => c.studentId === chosen) ?? children.data?.[0]
  const card = useReportCard(child?.studentId), fees = useFees(), mayFees = usePermission('fees.view'), mayHomework = usePermission('homework.view'), board = useHomeworkBoard(child?.studentId, mayHomework)
  const due = needsAttention(board.data ?? []), open = due.filter(item => item.group === 'missing')
  const rate = child ? percent(child.present + child.late, child.markedDays) : null, totals = feeTotals((fees.data ?? []).filter(charge => !child || charge.studentId === child.studentId))
  if (children.allowed && children.data?.length === 0) return <Card><AppText variant="heading">{student ? 'Your student record is not linked yet' : 'No children linked yet'}</AppText><AppText tone="muted">Ask the school office to link this account to the student record. Everything appears here straight away.</AppText></Card>
  return <>
    {!student && (children.data?.length ?? 0) > 1 && <Chips value={child?.studentId ?? ''} onChange={setChosen} options={children.data!.map(c => ({ key: c.studentId, label: c.name.split(' ')[0] }))} />}
    {!!child && <Pressable accessibilityRole="button" accessibilityLabel={'Attendance for ' + child.name} onPress={() => go('/children')} style={({ pressed }) => [styles.person, pressed && styles.pressed]}><Avatar label={initials(child.name)} size={44} /><View style={styles.flex}><AppText variant="heading" numberOfLines={1}>{child.name}</AppText><AppText variant="caption" tone="muted" numberOfLines={1}>{child.className || 'Class not allocated yet'}</AppText></View><Ionicons name="chevron-forward" size={18} color={color.textFaint} /></Pressable>}
    <Summary go={go} figures={[
      { value: children.data === undefined || rate === null ? dash : rate + '%', label: 'Attendance', note: child?.markedDays ? `${child.present + child.late} of ${child.markedDays} days` : 'Nothing marked yet', route: '/children' },
      ...(mayHomework ? [{ value: board.data === undefined ? dash : String(due.length), label: 'Homework due', note: board.data ? (open.length ? `${open.length} missing` : 'Nothing missing') : undefined, warn: open.length > 0, route: '/homework' as const }] : []),
      { value: card.data?.maximum ? card.data.percent + '%' : dash, label: 'Results', note: card.data?.maximum ? 'Grade ' + card.data.grade : 'None published', route: '/results' }]} />
    {mayFees && fees.data !== undefined && totals.count > 0 && <Group><ListItem icon="wallet-outline" title={totals.balance > 0 ? money(totals.currency, totals.balance) + ' outstanding' : 'Fees are up to date'} subtitle={`${totals.outstanding} of ${totals.count} charges with a balance`} onPress={() => go('/fees')} last /></Group>}
    <TodayLessons studentId={child?.studentId} go={go} />
    {mayHomework && <Group title="Homework due" action={<LinkText label="All homework" onPress={() => go('/homework')} />}>
      {board.data === undefined ? <View style={styles.pad}><Skeleton width="65%" /></View> : due.length === 0 ? <ListItem icon="book-outline" title="No homework due" last />
        : due.slice(0, 3).map((item, i, all) => <ListItem key={item.id} icon="book-outline" title={item.title} subtitle={[item.subjectName, GROUP_LABEL[item.group]].filter(Boolean).join(' · ')} meta={'Due ' + (dayParts(item.dueDate)?.label ?? item.dueDate)} onPress={() => go('/homework')} last={i === all.length - 1} />)}</Group>}
    <NoticesPreview go={go} /></>
}
function TeacherHome({ go }: { go: Go }) {
  const classes = useMyClasses(usePermission('classes.view')), today = isoDay(new Date()), register = useRegister(today), mayMark = usePermission('attendance.mark'), homework = useHomework(), mayHomework = usePermission('homework.view'), work = useHomeworkOverview(mayHomework)
  const summary = registerSummary(register.data ?? []), due = splitHomework(homework.data ?? [], today).upcoming, workTotals = overviewTotals(work.data ?? [])
  return <>
    <Summary go={go} figures={[
      { value: classes.data ? String(classes.data.total) : dash, label: 'My classes', route: '/classes' },
      { value: register.data ? `${summary.total - summary.unmarked}/${summary.total}` : dash, label: 'Marked today', note: register.data ? (summary.unmarked ? `${summary.unmarked} to mark` : summary.total ? 'Complete' : 'No students yet') : undefined, warn: !!register.data && summary.unmarked > 0, route: '/register' },
      ...(mayHomework ? [{ value: work.data ? String(workTotals.toReview) : homework.data ? String(due.length) : dash, label: work.data ? 'To review' : 'Homework set', note: work.data ? `${workTotals.missing} missing · ${workTotals.late} late` : 'Still due', warn: workTotals.toReview > 0, route: '/homework' as const }] : [])]} />
    {mayMark && !!register.data && summary.unmarked > 0 && <Group><ListItem icon="checkbox-outline" title="Take today’s attendance" subtitle={`${summary.unmarked} of ${summary.total} students not marked yet`} onPress={() => go('/register')} last /></Group>}
    <TodayLessons go={go} showClass /><NoticesPreview go={go} /></>
}
function PrincipalHome({ go }: { go: Go }) {
  const overview = useOverview(isoDay(new Date()), usePermission('overview.view')), leave = useLeave(), fees = useFees(), mayLeave = usePermission('leave-requests.view'), mayFees = usePermission('fees.view')
  const data = overview.data, rate = data ? percent(data.present, data.marked) : null, pending = (leave.data ?? []).filter(item => item.status === 'Pending').length, totals = feeTotals(fees.data ?? [])
  return <>
    <Summary go={go} figures={[
      { value: data ? data.students.toLocaleString('en-IN') : dash, label: 'Students', route: '/overview' }, { value: data ? data.teachers.toLocaleString('en-IN') : dash, label: 'Teaching staff', route: '/overview' },
      { value: rate === null ? dash : rate + '%', label: 'Present today', note: data ? (data.marked ? `${data.present} of ${data.marked} marked` : 'No register yet') : undefined, route: '/register' }]} />
    <Group title="Needs attention">
      {!!data && <ListItem icon="checkbox-outline" title={data.marked ? `${Math.max(0, data.marked - data.present)} absent or excused today` : 'No register marked yet today'} subtitle={`${Math.max(0, data.students - data.marked)} students not yet marked`} onPress={() => go('/register')} last={!mayLeave && !mayFees} />}
      {mayLeave && <ListItem icon="document-text-outline" title={leave.data === undefined ? 'Leave requests' : pending ? `${pending} leave request${pending === 1 ? '' : 's'} awaiting a decision` : 'No leave waiting for a decision'} onPress={() => go('/leave')} last={!mayFees} />}
      {mayFees && <ListItem icon="wallet-outline" title={fees.data === undefined ? 'Fees' : totals.count ? money(totals.currency, totals.balance) + ' outstanding' : 'No fee charges yet'} subtitle={fees.data && totals.count ? `${money(totals.currency, totals.paid)} received of ${money(totals.currency, totals.billed)} billed` : undefined} onPress={() => go('/fees')} last />}
    </Group>
    <NoticesPreview go={go} /></>
}

export function HomeScreen() {
  const user = useSession(state => state.user) as User, router = useRouter(), cache = useQueryClient(), brand = useBrand(), insets = useSafeAreaInsets(), [refreshing, setRefreshing] = useState(false)
  const school = useSchoolName(), experience = experienceFor(user), published = useSchoolHome().data?.home, hero = heroOf(published), entries = navigationFor(user).filter(entry => entry.route)
  const go: Go = route => router.navigate(route)
  const refresh = () => { setRefreshing(true); cache.invalidateQueries().finally(() => setRefreshing(false)) }
  return <View style={styles.page}><StatusBar style="light" />
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#ffffff" colors={[brand.primary]} progressViewOffset={insets.top} />}>
      <View style={[styles.band, { backgroundColor: brand.deep, paddingTop: insets.top + space.md }]}>
        <View style={styles.bandRow}>
          {/* Avatar, greeting and name are one control: the whole block opens Profile, for every role. */}
          <Pressable accessibilityRole="button" accessibilityLabel={'Profile: ' + ([user.firstName, user.lastName].filter(Boolean).join(' ') || user.username) + (user.roles[0] ? ', ' + user.roles[0] : '')} accessibilityHint="Opens your profile" onPress={() => go('/profile')} style={({ pressed }) => [styles.identity, pressed && styles.pressed]}>
            <Avatar label={initials([user.firstName, user.lastName].filter(Boolean).join(' ') || user.username) || 'U'} size={44} background="rgba(255,255,255,0.18)" foreground="#ffffff" />
            <View style={styles.flex}><AppText variant="caption" numberOfLines={1} style={{ color: brand.muted }}>{greeting(new Date().getHours())}{user.roles[0] ? ' · ' + user.roles[0] : ''}</AppText><AppText variant="heading" tone="inverse" accessibilityRole="header" numberOfLines={1}>{user.firstName || user.username}</AppText></View></Pressable>
          <NotificationBell tint="#ffffff" /></View>
        {!!school && <AppText variant="title" tone="inverse" numberOfLines={2} style={styles.schoolName}>{school}</AppText>}
        {!!BUILD_STAMP && <AppText variant="caption" style={{ color: brand.muted }}>{BUILD_STAMP}</AppText>}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actions} style={styles.actionsBleed}>
          {entries.map(entry => <Pressable key={entry.key} accessibilityRole="button" accessibilityLabel={entry.label} onPress={() => go(entry.route!)} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
            <View style={styles.actionIcon}><Ionicons name={entry.icon as IconName} size={22} color="#ffffff" /></View><AppText variant="caption" tone="inverse" numberOfLines={1}>{entry.label}</AppText></Pressable>)}</ScrollView>
      </View>
      <View style={styles.body}>
        {experience === 'parent' && <FamilyHome student={false} go={go} />}{experience === 'student' && <FamilyHome student go={go} />}{experience === 'teacher' && <TeacherHome go={go} />}{experience === 'principal' && <PrincipalHome go={go} />}
        {!!published && <Pressable accessibilityRole="button" accessibilityLabel={'Open School Home for ' + published.schoolName} onPress={() => router.push('/welcome')} style={({ pressed }) => [styles.school, { backgroundColor: brand.deep }, pressed && styles.pressed]}>
          {!!hero.bannerId && <><SchoolImage id={hero.bannerId} position={hero.bannerPosition} style={StyleSheet.absoluteFill} /><View style={[StyleSheet.absoluteFill, styles.shade]} /></>}
          <AppText variant="overline" tone="inverse">School Home</AppText><AppText variant="heading" tone="inverse" numberOfLines={1}>{published.schoolName}</AppText></Pressable>}
      </View>
    </ScrollView></View>
}
const styles = StyleSheet.create({
  flex: { flex: 1 }, pad: { padding: space.lg }, pressed: { opacity: 0.65 }, identity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 }, page: { flex: 1, backgroundColor: color.background }, scroll: { paddingBottom: space.xxxl },
  band: { paddingHorizontal: space.xl, paddingBottom: space.xl, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, gap: space.sm }, bandRow: { flexDirection: 'row', alignItems: 'center', gap: space.md }, schoolName: { marginTop: space.sm },
  actionsBleed: { marginHorizontal: -space.xl, marginTop: space.md }, actions: { paddingHorizontal: space.xl, gap: space.lg }, action: { alignItems: 'center', gap: space.sm, width: 68 },
  actionIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  body: { padding: space.lg, gap: space.lg },
  summary: { flexDirection: 'row', backgroundColor: color.surface, borderRadius: radius.xl, paddingVertical: space.lg, ...elevation.raised }, figure: { flex: 1, paddingHorizontal: space.md, gap: 2, alignItems: 'center' }, figureDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: color.border },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xs }, time: { width: 50 },
  school: { minHeight: 92, borderRadius: radius.xl, padding: space.lg, justifyContent: 'flex-end', gap: 2, overflow: 'hidden' }, shade: { backgroundColor: 'rgba(9, 24, 20, 0.55)' },
})
