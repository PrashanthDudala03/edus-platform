import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { experienceFor } from '@/access/experience'
import { Chips, Group, Header, ListItem, StatRow, StatTile } from '@/components/blocks'
import { QueryView } from '@/components/QueryView'
import { AppText, Badge, EmptyState, Notice, Screen } from '@/components/ui'
import { useSession } from '@/services'
import { color, space } from '@/theme/tokens'
import { dayParts } from '@/utils/format'
import { useChildren, useFeeSummary, useStudentLedger } from '../data'
import { STATE_LABEL, dueCharges, ledgerNote, money, stateTone } from '../logic'

// Fees from the school's own ledger. A parent picks a child, a student sees their own: what is due and when,
// overdue instalments, what was paid, and receipts with their numbers and status. Leadership sees the office
// summary. Every figure is the server's; payments are recorded at the office, and online payment opens from the
// web portal once the school has switched its own provider on.
export function FeesScreen() {
  const user = useSession(state => state.user), experience = experienceFor(user)
  return experience === 'parent' || experience === 'student' ? <FamilyFees student={experience === 'student'} /> : <OfficeFees />
}

function FamilyFees({ student }: { student: boolean }) {
  const children = useChildren(), [chosen, setChosen] = useState(''), child = children.data?.find(c => c.studentId === chosen) ?? children.data?.[0]
  const ledger = useStudentLedger(child?.studentId), [tab, setTab] = useState('due')
  return <Screen refreshing={ledger.isRefetching || children.isRefetching} onRefresh={() => { children.refetch(); ledger.refetch() }}>
    <Header overline={student ? 'My fees' : 'Family'} title="Fees" route="/fees" />
    <QueryView query={children} isEmpty={rows => !rows || rows.length === 0} empty={{ icon: 'wallet-outline', title: student ? 'Your student record is not linked yet' : 'No children linked yet', message: 'Fees appear once the school links this account to the student record.' }}>
      {rows => <>
        {(rows ?? []).length > 1 && <Chips value={child?.studentId ?? ''} onChange={setChosen} options={(rows ?? []).map(c => ({ key: c.studentId, label: c.name.split(' ')[0] }))} />}
        <QueryView query={ledger} empty={{ title: 'No fees yet', message: '' }}>{l => { const t = l.totals, due = dueCharges(l.charges); return <>
          <StatRow><StatTile value={money(t.currency, t.outstanding)} label="Outstanding" note={ledgerNote(t)} tone={t.outstanding > 0 ? 'warning' : 'default'} /><StatTile value={money(t.currency, t.overdue)} label="Overdue" note={`${t.overdueCount} past due`} tone={t.overdue > 0 ? 'warning' : 'default'} /></StatRow>
          <StatRow><StatTile value={money(t.currency, t.net)} label="Net payable" note={t.concessions > 0 ? `after ${money(t.currency, t.concessions)} concessions` : 'after concessions'} /><StatTile value={money(t.currency, t.paid)} label="Paid" note={`${l.payments.total} payment${l.payments.total === 1 ? '' : 's'}`} /></StatRow>
          <Chips value={tab} onChange={setTab} options={[{ key: 'due', label: 'Due', count: due.length }, { key: 'all', label: 'All instalments', count: l.charges.length }, { key: 'payments', label: 'Payments', count: l.payments.total }]} />
          {tab !== 'payments' ? <Group title={tab === 'due' ? 'Instalments due' : 'All instalments'}>{(tab === 'due' ? due : l.charges).length === 0 ? <ListItem icon="wallet-outline" title={tab === 'due' ? 'Nothing due' : 'No fee charges yet'} subtitle={tab === 'due' ? 'Every instalment issued so far is settled.' : 'Charges issued by the school appear here.'} last /> : (tab === 'due' ? due : l.charges).map((c, i, all) => <ListItem key={c.id} icon="wallet-outline" title={c.description} subtitle={`Due ${dayParts(c.dueDate)?.label ?? c.dueDate} · ${money(c.currency, c.net)} net · ${money(c.currency, c.paid)} paid`} trailing={<View style={styles.end}><AppText variant="bodyStrong">{c.outstanding > 0 ? money(c.currency, c.outstanding) : ''}</AppText><Badge label={STATE_LABEL[c.state]} tone={stateTone(c.state)} /></View>} last={i === all.length - 1} />)}</Group>
            : <Group title="Payments and receipts">{l.payments.items.length === 0 ? <ListItem icon="receipt-outline" title="No payments yet" subtitle="Payments recorded by the school office appear here with their receipt numbers." last /> : l.payments.items.map((p, i, all) => <ListItem key={p.id} icon="receipt-outline" title={money(p.currency, p.amount) + ' · ' + p.method} subtitle={[p.description, p.reference, p.status === 'Reversed' ? 'Reversed: ' + p.reversalReason : ''].filter(Boolean).join(' · ')} meta={(dayParts(p.paidOn)?.label ?? p.paidOn) + ' · receipt ' + p.receipt} trailing={<Badge label={p.status} tone={p.status === 'Reversed' ? 'danger' : 'success'} />} last={i === all.length - 1} />)}
              {l.payments.more && <AppText variant="caption" tone="muted">Earlier payments are on the EduOS web portal.</AppText>}</Group>}
          {l.online.enabled ? <Notice message="This school accepts online payments into its own account. Pay from the EduOS web portal; the receipt is issued once the provider confirms the payment." /> : <AppText variant="caption" tone="faint">Payments are recorded by the school office. Receipts can be printed from the EduOS web portal.</AppText>}
        </> }}</QueryView></>}
    </QueryView>
  </Screen>
}

function OfficeFees() {
  const summary = useFeeSummary()
  return <Screen refreshing={summary.isRefetching} onRefresh={() => { summary.refetch() }}>
    <Header overline="Finance" title="Fees" route="/fees" />
    <QueryView query={summary} empty={{ title: 'No fees yet', message: '' }}>{s => { const c = s.totals.currency; return <>
      <StatRow><StatTile value={money(c, s.collectedToday)} label="Collected today" /><StatTile value={money(c, s.collectedThisMonth)} label="This month" note={s.reversalsThisMonth ? `${s.reversalsThisMonth} reversal${s.reversalsThisMonth === 1 ? '' : 's'}` : undefined} /></StatRow>
      <StatRow><StatTile value={money(c, s.totals.outstanding)} label="Outstanding" note={ledgerNote(s.totals)} tone={s.totals.outstanding > 0 ? 'warning' : 'default'} /><StatTile value={money(c, s.totals.overdue)} label="Overdue" note={`${s.totals.overdueCount} charges past due`} tone={s.totals.overdue > 0 ? 'warning' : 'default'} /></StatRow>
      <Group title="Dues by class">{s.byClass.length === 0 ? <ListItem icon="wallet-outline" title="No charges yet" last /> : s.byClass.map((r, i, all) => <ListItem key={r.class} icon="people-outline" title={r.class || 'Not allocated'} subtitle={`${money(c, r.paid)} received`} trailing={<View style={styles.end}><AppText variant="bodyStrong">{money(c, r.outstanding)}</AppText>{r.overdue > 0 && <Badge label={money(c, r.overdue) + ' overdue'} tone="danger" />}</View>} last={i === all.length - 1} />)}</Group>
      <Group title="Recent payments">{s.recent.length === 0 ? <ListItem icon="receipt-outline" title="No payments recorded yet" last /> : s.recent.map((p, i, all) => <ListItem key={p.id} icon="receipt-outline" title={money(p.currency, p.amount) + ' · ' + p.student} subtitle={p.method + ' · receipt ' + p.receipt} meta={dayParts(p.paidOn)?.label} trailing={<Badge label={p.status} tone={p.status === 'Reversed' ? 'danger' : 'success'} />} last={i === all.length - 1} />)}</Group>
      <AppText variant="caption" tone="faint">Collecting payments, concessions, reversals and reports are on the EduOS web portal.</AppText>
    </> }}</QueryView>
    {summary.isError && <EmptyState icon="wallet-outline" title="Fees are not available" message="This account cannot read the school ledger." />}
  </Screen>
}
const styles = StyleSheet.create({ end: { alignItems: 'flex-end', gap: space.xs }, pad: { padding: space.md, backgroundColor: color.surface } })
