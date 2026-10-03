import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { experienceFor } from '@/access/experience'
import { Header, Stepper } from '@/components/blocks'
import { QueryView } from '@/components/QueryView'
import { AppText, Avatar, Badge, Card, Screen } from '@/components/ui'
import { useSession } from '@/services'
import { color, space } from '@/theme/tokens'
import { initials, isoMonth, percent } from '@/utils/format'
import { useChildren } from '../data'
import type { Child } from '../logic'

// The students linked to this account and their attendance for a month: a parent's children, or the student's own
// record. GET /suite/reports/attendance returns a row for every linked student, including those with nothing marked.
// EduOS has no day-by-day attendance endpoint for families, so the month's totals are what can be shown.
/** Present and late both count as attended, as on the web register. */
export const attended = (child: Child) => percent(child.present + child.late, child.markedDays)

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const shift = (month: string, by: number) => { const [year, index] = month.split('-').map(Number); return isoMonth(new Date(year, index - 1 + by, 1)) }
const title = (month: string) => { const [year, index] = month.split('-').map(Number); return `${MONTHS[index - 1]} ${year}` }

export function ChildrenScreen() {
  const current = isoMonth(new Date()), [month, setMonth] = useState(current), student = experienceFor(useSession(state => state.user)) === 'student'
  const children = useChildren(month)
  return <Screen refreshing={children.isRefetching} onRefresh={() => { children.refetch() }}>
    <Header overline={student ? 'My record' : 'My family'} title={student ? 'Attendance' : 'Children'} route="/children" />
    <Stepper label={title(month)} onPrevious={() => setMonth(shift(month, -1))} onNext={() => setMonth(shift(month, 1))} nextDisabled={month >= current} />
    <QueryView query={children} isEmpty={rows => rows.length === 0} empty={{ icon: 'people-outline', title: student ? 'Your student record is not linked yet' : 'No children linked yet', message: 'Ask the school office to link this account to the student record. It will appear here straight away.' }}>
      {rows => <View style={styles.list}>{rows.map(child => { const rate = attended(child)
        return <Card key={child.studentId}>
          <View style={styles.row}><Avatar label={initials(child.name)} size={48} /><View style={styles.flex}><AppText variant="heading">{child.name}</AppText>
            <AppText variant="caption" tone="muted">{[child.className, child.admissionNumber].filter(Boolean).join(' · ')}</AppText></View>
            {rate !== null && <View style={styles.rate}><AppText variant="title" tone="primary">{rate}%</AppText><AppText variant="caption" tone="muted">attended</AppText></View>}</View>
          {child.markedDays === 0 ? <AppText tone="muted" style={styles.gap}>No attendance has been marked for this month yet.</AppText> : <>
            <View style={styles.bar} accessibilityLabel={`Attended ${rate} percent of ${child.markedDays} marked days`}><View style={[styles.barFill, { width: `${rate ?? 0}%` }]} /></View>
            <View style={styles.badges}><Badge label={`Present ${child.present}`} tone="success" /><Badge label={`Late ${child.late}`} tone="warning" /><Badge label={`Absent ${child.absent}`} tone="danger" /><Badge label={`Excused ${child.excused}`} /></View></>}
        </Card> })}</View>}
    </QueryView>
  </Screen>
}
const styles = StyleSheet.create({
  flex: { flex: 1 }, list: { gap: space.md }, gap: { marginTop: space.md }, row: { flexDirection: 'row', alignItems: 'center', gap: space.md }, rate: { alignItems: 'flex-end' },
  bar: { height: 8, borderRadius: 4, backgroundColor: color.surfaceMuted, marginTop: space.lg, overflow: 'hidden' }, barFill: { height: 8, borderRadius: 4, backgroundColor: color.primary },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
})
