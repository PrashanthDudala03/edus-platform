import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { QueryView } from '@/components/QueryView'
import { Header } from '@/components/blocks'
import { AppText, Card, Screen } from '@/components/ui'
import { api } from '@/services'
import { color, radius, space, touch } from '@/theme/tokens'
import { lessonsByDay, weekdayOf, type Lesson } from '@/utils/format'

// Student proof slice (also used by teachers): the weekly timetable. GET /suite/records/timetable returns only the
// lessons of the person's own classes. It serves 20 records a page with no "whole week" option, so the pages are
// read in turn; subject, class and teacher names come from the existing GET /suite/options.
const MAX_PAGES = 10
export function useTimetable(enabled = true) {
  return useQuery({
    queryKey: ['records', 'timetable'], enabled,
    queryFn: async (): Promise<Lesson[]> => {
      const lessons: Lesson[] = []
      for (let page = 1; page <= MAX_PAGES; page++) {
        const result = (await api.get('/suite/records/timetable', { params: { page } })).data.data as { data: Record<string, unknown>[], totalCount: number }
        lessons.push(...result.data.map(row => ({ id: String(row.id ?? ''), day: String(row.day ?? ''), startsAt: String(row.startsAt ?? ''), endsAt: String(row.endsAt ?? ''), classId: String(row.classId ?? ''), subjectId: String(row.subjectId ?? ''), teacherId: String(row.teacherId ?? ''), room: String(row.room ?? '') })))
        if (result.data.length === 0 || lessons.length >= Number(result.totalCount)) break
      }
      return lessons
    },
  })
}
type Options = Record<string, { id: string, label: string }[] | undefined>
export function useNames(enabled = true) {
  const options = useQuery({ queryKey: ['suite-options'], enabled, staleTime: 10 * 60_000, queryFn: async () => (await api.get('/suite/options')).data.data as Options })
  return (source: 'subjects' | 'classes' | 'teachers', id: string) => options.data?.[source]?.find(option => option.id === id)?.label ?? ''
}

export function TimetableScreen() {
  const timetable = useTimetable(), name = useNames(), today = weekdayOf(new Date())
  const [chosen, setChosen] = useState<string | null>(null)
  return <Screen refreshing={timetable.isRefetching} onRefresh={() => { timetable.refetch() }}>
    <Header overline="This week" title="Timetable" route="/timetable" />
    <QueryView query={timetable} isEmpty={lessons => lessons.length === 0} empty={{ icon: 'time-outline', title: 'No timetable yet', message: 'Your lessons appear here once the school publishes the timetable for your class.' }}>
      {lessons => {
        const days = lessonsByDay(lessons), day = days.find(group => group.day === (chosen ?? today)) ?? days[0]
        return <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>{days.map(group => { const active = group.day === day.day
            return <Pressable key={group.day} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={group.day + (group.day === today ? ', today' : '')} onPress={() => setChosen(group.day)} style={[styles.day, active && styles.dayActive]}>
              <AppText variant="label" tone={active ? 'inverse' : 'muted'}>{group.day.slice(0, 3)}{group.day === today ? ' · today' : ''}</AppText></Pressable> })}</ScrollView>
          <View style={styles.list}>{day.lessons.map(lesson => { const subject = name('subjects', lesson.subjectId), detail = [name('classes', lesson.classId), name('teachers', lesson.teacherId), lesson.room && 'Room ' + lesson.room].filter(Boolean).join(' · ')
            return <Card key={lesson.id} style={styles.lesson}><View style={styles.time}><AppText variant="bodyStrong">{lesson.startsAt}</AppText><AppText variant="caption" tone="muted">{lesson.endsAt}</AppText></View>
              <View style={styles.flex}><AppText variant="heading">{subject || 'Lesson'}</AppText>{!!detail && <AppText variant="caption" tone="muted">{detail}</AppText>}</View></Card> })}</View>
        </>
      }}
    </QueryView>
  </Screen>
}
const styles = StyleSheet.create({
  flex: { flex: 1 }, list: { gap: space.md }, days: { gap: space.sm },
  day: { minHeight: touch - 6, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, alignItems: 'center', justifyContent: 'center' },
  dayActive: { backgroundColor: color.primary, borderColor: color.primary },
  lesson: { flexDirection: 'row', alignItems: 'center', gap: space.lg }, time: { width: 58, borderRightWidth: 1, borderRightColor: color.border },
})
