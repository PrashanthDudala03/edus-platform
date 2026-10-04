import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { experienceFor } from '@/access/experience'
import { QueryView } from '@/components/QueryView'
import { Chips, Header } from '@/components/blocks'
import { AppText, Badge, Card, Screen } from '@/components/ui'
import { useSession } from '@/services'
import { color, radius, space, touch } from '@/theme/tokens'
import { dayParts, isoDay } from '@/utils/format'
import { useChildren, useTimetableDay } from '../data'
import { dateOf, dayRows, nextLesson, periodNote, periodTone, positionOf, shownRows, weekStart, weekdayOfDate, WEEKDAYS } from '../timetable'

// Timetable 2.0: one day at a time from GET /suite/timetable/today, which already applies the role's scope and puts
// the substitute's name on a covered lesson. A teacher sees their own lessons and the ones they cover; a student
// their class; a parent the chosen child's class. Nothing here reads leave.
export function TimetableScreen() {
  const user = useSession(state => state.user), experience = experienceFor(user), today = isoDay(new Date())
  const children = useChildren(undefined, experience === 'parent'), [chosenChild, setChosenChild] = useState('')
  const child = children.data?.find(c => c.studentId === chosenChild) ?? children.data?.[0]
  const [date, setDate] = useState(today), monday = weekStart(date)
  const day = useTimetableDay(date, experience === 'parent' ? child?.studentId : undefined, experience !== 'parent' || !!child)
  const now = new Date(), nowMinutes = now.getHours() * 60 + now.getMinutes(), isToday = date === today
  return <Screen refreshing={day.isRefetching} onRefresh={() => { day.refetch() }}>
    <Header overline={dayParts(date)?.label ?? date} title={experience === 'teacher' ? 'My timetable' : 'Timetable'} route="/timetable" />
    {experience === 'parent' && (children.data?.length ?? 0) > 1 && <Chips value={child?.studentId ?? ''} onChange={setChosenChild} options={children.data!.map(c => ({ key: c.studentId, label: c.name }))} style={styles.chips} />}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>{WEEKDAYS.map((name, i) => { const d = dateOf(monday, i), active = d === date
      return <Pressable key={name} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={name + ' ' + d + (d === today ? ', today' : '')} onPress={() => setDate(d)} style={[styles.day, active && styles.dayActive]}>
        <AppText variant="label" tone={active ? 'inverse' : 'muted'}>{name.slice(0, 3)}{d === today ? ' · today' : ''}</AppText></Pressable> })}</ScrollView>
    <View style={styles.weekNav}><Pressable accessibilityRole="button" accessibilityLabel="Previous week" onPress={() => setDate(dateOf(monday, -7))} style={styles.weekButton}><AppText variant="label" tone="primary">‹ Week</AppText></Pressable><AppText variant="caption" tone="muted">{weekdayOfDate(date)}{day.data?.className ? ' · ' + day.data.className : ''}</AppText><Pressable accessibilityRole="button" accessibilityLabel="Next week" onPress={() => setDate(dateOf(monday, 7))} style={styles.weekButton}><AppText variant="label" tone="primary">Week ›</AppText></Pressable></View>
    <QueryView query={day} isEmpty={d => shownRows(dayRows(d.slots, d.periods)).length === 0} empty={{ icon: 'time-outline', title: 'No lessons this day', message: experience === 'teacher' ? 'Nothing is on your timetable for this day.' : 'Nothing is on the class timetable for this day.' }}>
      {d => { const rows = shownRows(dayRows(d.slots, d.periods)), pos = isToday ? positionOf(rows, nowMinutes) : { current: -1, next: -1 }, next = isToday ? nextLesson(rows, nowMinutes) : undefined
        return <>
          {d.away && <Badge label="You are on leave this day" tone="warning" />}
          {next && <Card style={styles.next} label={'Next: ' + next.periods.map(p => p.subjectName).join(', ')}><AppText variant="label" tone="primary">{pos.current >= 0 && rows[pos.current] === next ? 'Now' : 'Next'} · {next.startsAt}–{next.endsAt}</AppText><AppText variant="heading">{next.periods.map(p => p.subjectName).join(', ')}</AppText><AppText variant="caption" tone="muted">{next.periods.map(p => periodNote(p, experience === 'teacher' || experience === 'principal')).join(' · ')}</AppText></Card>}
          <View style={styles.list}>{rows.map((row, i) => <Card key={row.key} style={[styles.lesson, i === pos.current && styles.now]}>
            <View style={styles.time}><AppText variant="bodyStrong">{row.startsAt}</AppText><AppText variant="caption" tone="muted">{row.endsAt}</AppText></View>
            <View style={styles.flex}>{row.periods.length === 0 ? <AppText variant="heading" tone="muted">{row.name || row.type}</AppText> : row.periods.map(p => <View key={p.id}><AppText variant="heading">{p.subjectName || 'Lesson'}{row.name ? ' · ' + row.name : ''}</AppText><AppText variant="caption" tone="muted">{periodNote(p, experience === 'teacher' || experience === 'principal')}</AppText></View>)}</View>
            {row.periods.some(p => p.substituted || p.covering || p.status === 'uncovered') && <Badge label={row.periods.some(p => p.status === 'uncovered') ? 'Needs cover' : row.periods.some(p => p.covering) ? 'Covering' : 'Substitute'} tone={periodTone(row.periods[0]!)} />}
          </Card>)}</View>
        </>
      }}
    </QueryView>
  </Screen>
}
const styles = StyleSheet.create({
  flex: { flex: 1 }, list: { gap: space.md }, days: { gap: space.sm }, chips: { marginBottom: space.sm },
  day: { minHeight: touch - 6, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, alignItems: 'center', justifyContent: 'center' },
  dayActive: { backgroundColor: color.primary, borderColor: color.primary },
  weekNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: space.sm }, weekButton: { minHeight: touch - 12, justifyContent: 'center', paddingHorizontal: space.sm },
  next: { borderLeftWidth: 3, borderLeftColor: color.primary, marginBottom: space.md },
  lesson: { flexDirection: 'row', alignItems: 'center', gap: space.lg }, now: { borderWidth: 2, borderColor: color.primary }, time: { width: 58, borderRightWidth: 1, borderRightColor: color.border },
})
