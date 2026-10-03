import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Chips, Group, Header, ListItem, StatRow, StatTile } from '@/components/blocks'
import { QueryView } from '@/components/QueryView'
import { AppText, Badge, EmptyState, Screen } from '@/components/ui'
import { space } from '@/theme/tokens'
import { useChildren, useReportCard } from '../data'
import { componentsLabel, resultLabel } from '../logic'

// Results for a family: the report card EduOS computes from published exams only, one child at a time, with each
// exam's components, grade and attendance for the period. Printing the report card stays on the web.
export function ResultsScreen() {
  const children = useChildren(), [chosen, setChosen] = useState('')
  const child = children.data?.find(c => c.studentId === chosen) ?? children.data?.[0], card = useReportCard(child?.studentId)
  return <Screen refreshing={card.isRefetching || children.isRefetching} onRefresh={() => { children.refetch(); card.refetch() }}>
    <Header overline="Progress" title="Results" route="/results" />
    <QueryView query={children} isEmpty={rows => !rows || rows.length === 0} empty={{ icon: 'ribbon-outline', title: 'No student linked yet', message: 'Results appear once the school links this account to a student record.' }}>
      {rows => <>
        {(rows ?? []).length > 1 && <Chips value={child?.studentId ?? ''} onChange={setChosen} options={(rows ?? []).map(c => ({ key: c.studentId, label: c.name.split(' ')[0] }))} />}
        <QueryView query={card} empty={{ title: 'No results yet', message: '' }}>
          {report => report.results.length === 0 ? <EmptyState icon="ribbon-outline" title="No published results yet" message="Marks appear here once the school publishes an exam." /> : <>
            <StatRow><StatTile value={report.maximum ? report.percent + '%' : '—'} label="Overall" note={report.maximum ? `${report.obtained} of ${report.maximum} marks` : 'Grade-only results'} /><StatTile value={report.grade} label="Grade" note={`${report.passed} passed${report.failed ? ` · ${report.failed} below pass` : ''}`} /></StatRow>
            {!!report.attendance && <StatRow><StatTile value={report.attendance.percent == null ? '—' : report.attendance.percent + '%'} label="Attendance" note={`${report.attendance.markedDays} days marked${report.year ? ' · ' + report.year : ''}`} /></StatRow>}
            <Group title={child ? child.name : 'Exams'}>{report.results.map((result, i) => <ListItem key={i} icon="document-text-outline" title={result.subject} subtitle={[result.exam, result.term, componentsLabel(result.components), result.remarks].filter(Boolean).join(' · ')} last={i === report.results.length - 1}
              trailing={<View style={styles.score}><AppText variant="bodyStrong">{resultLabel(result)}</AppText>{result.status === 'Exempt' ? <Badge label="Exempt" tone="neutral" /> : <Badge label={result.grade ? result.grade + (result.pass ? ' · Pass' : ' · Below pass') : result.pass ? 'Pass' : 'Below pass'} tone={result.pass ? 'success' : 'danger'} />}</View>} />)}</Group>
            <AppText variant="caption" tone="faint">Only published exams with entered marks are included. This is not a board-issued certificate. The printable report card is on the EduOS web portal.</AppText></>}
        </QueryView></>}
    </QueryView>
  </Screen>
}
const styles = StyleSheet.create({ score: { alignItems: 'flex-end', gap: space.xs } })
