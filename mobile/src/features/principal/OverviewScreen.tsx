import { StyleSheet, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { QueryView } from '@/components/QueryView'
import { Header } from '@/components/blocks'
import { AppText, Badge, Card, Screen } from '@/components/ui'
import { api } from '@/services'
import { color, space } from '@/theme/tokens'
import { dayParts, figure, isoDay, percent } from '@/utils/format'
import { useRegisters } from '../data'
import { registerDone } from '../logic'

// Leadership proof slice: the school's operations overview for today. GET /operations/overview is the same call the
// web Administrator dashboard uses; the gateway supplies the school from the token.
export interface Overview { students: number, teachers: number, parents: number, classes: number, present: number, marked: number, byClass: { name: string, count: number }[] }

export function useOverview(day: string, enabled = true) {
  return useQuery({
    queryKey: ['operations-overview', day], enabled,
    queryFn: async (): Promise<Overview> => {
      const data = (await api.get('/operations/overview', { params: { day } })).data.data as { stats?: Record<string, unknown>, classes?: Record<string, unknown>[] }
      const n = (key: string) => Number(data.stats?.[key]) || 0
      return { students: n('students'), teachers: n('teachers'), parents: n('parents'), classes: n('classes'), present: n('present'), marked: n('marked'),
        byClass: (data.classes ?? []).map(row => ({ name: String(row.name ?? ''), count: Number(row.count) || 0 })).filter(row => row.name) }
    },
  })
}

export function OverviewScreen() {
  const today = isoDay(new Date()), overview = useOverview(today), registers = useRegisters(today)
  return <Screen refreshing={overview.isRefetching} onRefresh={() => { overview.refetch() }}>
    <Header overline={dayParts(today)?.label ?? 'Today'} title="School overview" route="/overview" />
    <QueryView query={overview} empty={{ title: 'Nothing to show yet', message: 'Figures appear once students and staff are added.' }} rows={4}>
      {data => { const rate = percent(data.present, data.marked), largest = Math.max(1, ...data.byClass.map(row => row.count))
        return <>
          <View style={styles.grid}>{[['Students', data.students], ['Teaching staff', data.teachers], ['Parents & guardians', data.parents], ['Class groups', data.classes]].map(([label, value]) =>
            <Card key={label} style={styles.tile}><AppText variant="display" tone="primary">{figure(value)}</AppText><AppText variant="caption" tone="muted">{label}</AppText></Card>)}</View>
          <Card><AppText variant="heading">Attendance today</AppText>
            {data.marked === 0 ? <AppText tone="muted" style={styles.gap}>No register has been marked yet today.</AppText> : <>
              <View style={styles.rateRow}><AppText variant="display" tone="primary">{rate}%</AppText><AppText tone="muted">present or late</AppText></View>
              <View style={styles.bar} accessibilityLabel={`${rate} percent present of ${data.marked} marked`}><View style={[styles.barFill, { width: `${rate ?? 0}%` }]} /></View>
              <AppText variant="caption" tone="muted" style={styles.gap}>{figure(data.present)} of {figure(data.marked)} marked · {figure(Math.max(0, data.students - data.marked))} not yet marked</AppText></>}
          </Card>
          {!!registers.data?.classes.length && <Card><AppText variant="heading">Today's registers</AppText>
            <AppText variant="caption" tone="muted" style={styles.gap}>{registers.data.totals.completed} submitted · {registers.data.totals.pending} pending · {figure(registers.data.totals.absent)} absent · {figure(registers.data.totals.late)} late</AppText>
            {registers.data.classes.map(r => <View key={r.className} style={styles.registerRow}><View style={styles.flex}><AppText variant="bodyStrong" numberOfLines={1}>{r.className}</AppText><AppText variant="caption" tone="muted" numberOfLines={1}>{[r.teacher, `${r.marked} of ${r.expected} marked`].filter(Boolean).join(' · ')}</AppText></View>
              <Badge label={r.state} tone={registerDone(r.state) ? 'success' : r.state === 'Not started' ? 'danger' : 'warning'} /></View>)}</Card>}
          {data.byClass.length > 0 && <Card><AppText variant="heading">Enrolment by class</AppText>
            {data.byClass.slice(0, 10).map(row => <View key={row.name} style={styles.classRow}><AppText style={styles.className} numberOfLines={1}>{row.name}</AppText>
              <View style={styles.classBar}><View style={[styles.barFill, { width: `${(row.count / largest) * 100}%` }]} /></View><AppText variant="bodyStrong" style={styles.classCount}>{figure(row.count)}</AppText></View>)}
            {data.byClass.length > 10 && <AppText variant="caption" tone="muted" style={styles.gap}>Showing 10 of {data.byClass.length} class groups.</AppText>}</Card>}
        </> }}
    </QueryView>
  </Screen>
}
const styles = StyleSheet.create({
  flex: { flex: 1 }, registerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md }, gap: { marginTop: space.md }, grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.md }, tile: { width: '48.2%', gap: space.xs },
  rateRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, marginTop: space.sm },
  bar: { height: 8, borderRadius: 4, backgroundColor: color.surfaceMuted, marginTop: space.md, overflow: 'hidden' }, barFill: { height: 8, borderRadius: 4, backgroundColor: color.primary },
  classRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md }, className: { width: 92 }, classBar: { flex: 1, height: 8, borderRadius: 4, backgroundColor: color.surfaceMuted, overflow: 'hidden' }, classCount: { width: 44, textAlign: 'right' },
})
