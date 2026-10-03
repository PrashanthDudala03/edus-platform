import { useState } from 'react'
import { Chips, Header, ListItem, StatRow, StatTile } from '@/components/blocks'
import { ListScreen } from '@/components/ListScreen'
import { AppText, Badge } from '@/components/ui'
import { dayParts } from '@/utils/format'
import { useFees } from '../data'
import { feeTotals, money } from '../logic'

// Fees, view only: the charges and what has been received against them. Families see their own children's charges;
// leadership sees the school's. Payments are recorded by the school office; nothing is paid from the app.
export function FeesScreen() {
  const fees = useFees(), [tab, setTab] = useState('due')
  const all = fees.data, due = all?.filter(charge => charge.balance > 0), shown = tab === 'due' ? due : all, totals = feeTotals(all ?? [])
  const several = new Set((all ?? []).map(charge => charge.studentId)).size > 1
  return <ListScreen source={fees} items={shown} keyOf={charge => charge.id}
    top={<><Header overline="Finance" title="Fees" route="/fees" />
      {!!all?.length && <><StatRow><StatTile value={money(totals.currency, totals.balance)} label="Outstanding" tone={totals.balance > 0 ? 'warning' : 'default'} note={`${totals.outstanding} of ${totals.count} charges`} /></StatRow>
        <StatRow><StatTile value={money(totals.currency, totals.billed)} label="Billed" note="After concessions" /><StatTile value={money(totals.currency, totals.paid)} label="Received" /></StatRow></>}
      <Chips value={tab} onChange={setTab} options={[{ key: 'due', label: 'Balance due', count: due?.length }, { key: 'all', label: 'All charges', count: all?.length }]} />
      <AppText variant="caption" tone="faint">Payments are recorded by the school office. This is a view of the ledger.</AppText></>}
    empty={tab === 'due' ? { icon: 'wallet-outline', title: 'Nothing outstanding', message: 'Every charge issued so far has been settled.' } : { icon: 'wallet-outline', title: 'No fee charges yet', message: 'Charges issued by the school will appear here.' }}
    row={(charge, index, rows) => <ListItem icon="wallet-outline" title={charge.description || 'Fee charge'} subtitle={[several ? charge.student : '', 'Due ' + (dayParts(charge.dueDate)?.label ?? charge.dueDate)].filter(Boolean).join(' · ')}
      meta={`${money(charge.currency, charge.gross - charge.concession)} billed · ${money(charge.currency, charge.paid)} received`} last={index === rows.length - 1}
      trailing={<Badge label={charge.balance > 0 ? money(charge.currency, charge.balance) + ' due' : 'Paid'} tone={charge.balance > 0 ? 'warning' : 'success'} />} />} />
}
