import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Chips, Group, Header, ListItem, StatRow, StatTile } from '@/components/blocks'
import { QueryView } from '@/components/QueryView'
import { AppText, Badge, EmptyState, Screen } from '@/components/ui'
import { space } from '@/theme/tokens'
import { useChildren, useReportCard } from '../data'

// Results for a family: the report card EduOS already computes (published exams only), one child at a time.
export function ResultsScreen() {
  const children = useChildren(), [chosen, setChosen] = useState('')
  const child = children.data?.find(c => c.studentId === chosen) ?? children.data?.[0], card = useReportCard(child?.studentId)
  return <Screen refreshing={card.isRefetching || children.isRefetching} onRefresh={() => { children.refetch(); card.refetch() }}>
    <Header overline="Progress" title="Results" route="/results" />
    <QueryView query={children} isEmpty={rows => !rows || rows.length === 0} empty={{ icon: 'ribbon-outline', title: 'No student linked yet', message: 'Results appear once the school links this account to a student record.' }}>
      {rows => <>
        {(rows ?? []).length > 1 && <Chips value={child?.studentId ?? ''} onChange={setChosen} options={(rows ?? []).map(c => ({ key: c.studentId, label: c.name.split(' ')[0] }))} />}
        <QueryView query={card} empty={{ title: 'No results yet', message: '' }}>
          {report => report.maximum === 0 ? <EmptyState icon="ribbon-outline" title="No published results yet" message="Marks appear here once the school publishes an exam." /> : <>
            <StatRow><StatTile value={report.percent + '%'} label="Overall" note={`${report.obtained} of ${report.maximum} marks`} /><StatTile value={report.grade} label="Grade" note="Across published exams" /></StatRow>
            <Group title={child ? child.name : 'Exams'}>{report.results.map((result, i) => <ListItem key={i} icon="document-text-outline" title={result.subject} subtitle={result.exam + (result.remarks ? ' · ' + result.remarks : '')} last={i === report.results.length - 1}
              trailing={<View style={styles.score}><AppText variant="bodyStrong">{result.score} / {result.maximum}</AppText><Badge label={result.pass ? 'Pass' : 'Below pass'} tone={result.pass ? 'success' : 'danger'} /></View>} />)}</Group>
            <AppText variant="caption" tone="faint">Only published exams with entered marks are included. This is not a board-issued certificate.</AppText></>}
        </QueryView></>}
    </QueryView>
  </Screen>
}
const styles = StyleSheet.create({ score: { alignItems: 'flex-end', gap: space.xs } })
