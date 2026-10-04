import { useState } from 'react'
import { Alert, StyleSheet, View } from 'react-native'
import { experienceFor } from '@/access/experience'
import { normalizeError } from '@/api/errors'
import { Chips, Header, LinkText, ListItem, Sheet, StatRow, StatTile, Stepper } from '@/components/blocks'
import { ListScreen } from '@/components/ListScreen'
import { AppText, Badge, Button, Notice, Skeleton, TextField } from '@/components/ui'
import { useSession } from '@/services'
import { dayParts, dayRange, isoDay } from '@/utils/format'
import { useAssignSubstitute, useCancelLeave, useCandidates, useDecideLeave, useLeave, useLeaveBalances, useLeaveImpact, useLeaveQueue, useNames, useOperations, usePermission, useRequestLeave } from '../data'
import { leaveDaysOf, shiftDay, type Leave } from '../logic'
import { impactWord, type Period } from '../timetable'

// Leave & Approvals 2.0. A teacher sees balances, raises a request (type, dates or a half day, reason) and withdraws a
// pending one; leadership works the queue with the balance and the lessons each request leaves uncovered, decides
// with a remark, and covers today's absences with a substitute. Days, balances and impact are the server's figures.
const tone = (status: string) => status === 'Approved' ? 'success' as const : status === 'Rejected' ? 'danger' as const : status === 'Cancelled' ? 'neutral' as const : 'warning' as const
const fmt = (n: number | null | undefined) => n == null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1)

export function LeaveScreen() {
  const user = useSession(state => state.user), leadership = experienceFor(user) === 'principal'
  return leadership ? <LeadershipLeave /> : <TeacherLeave />
}

function TeacherLeave() {
  const mayRequest = usePermission('leave-requests.manage'), leave = useLeave(), balances = useLeaveBalances(), request = useRequestLeave(), cancel = useCancelLeave(), today = isoDay(new Date())
  const [tab, setTab] = useState('Requests'), [open, setOpen] = useState<Leave | null>(null), [failure, setFailure] = useState('')
  const [form, setForm] = useState<{ typeId: string, fromDate: string, toDate: string, halfDay: string, reason: string } | null>(null)
  const sorted = leave.data && [...leave.data].sort((a, b) => b.fromDate.localeCompare(a.fromDate)), types = balances.data?.balances.filter(b => b.active) ?? []
  const staffId = balances.data?.teacherId
  const send = () => { if (!form || !staffId) return; setFailure('')
    request.mutate({ teacherId: staffId, typeId: form.typeId, fromDate: form.fromDate, toDate: form.halfDay === 'No' ? form.toDate : form.fromDate, halfDay: form.halfDay, reason: form.reason.trim() }, { onSuccess: () => { setForm(null); setTab('Requests') }, onError: error => setFailure(normalizeError(error).message) }) }
  const withdraw = (item: Leave) => Alert.alert('Withdraw this request?', 'It will be marked as cancelled.', [{ text: 'Keep', style: 'cancel' }, { text: 'Withdraw', style: 'destructive', onPress: () => cancel.mutate({ leave: item }, { onSuccess: () => setOpen(null), onError: error => setFailure(normalizeError(error).message) }) }])
  return <><ListScreen source={leave} items={tab === 'Requests' ? sorted : []} keyOf={item => item.id}
    top={<><Header overline="Staff" title="My leave" route="/leave" right={mayRequest && staffId ? <LinkText label="Request leave" onPress={() => { setFailure(''); setForm({ typeId: types.find(t => !t.tracksBalance || (t.afterPending ?? 0) > 0)?.typeId ?? types[0]?.typeId ?? '', fromDate: today, toDate: today, halfDay: 'No', reason: '' }) }} /> : undefined} />
      <Chips value={tab} onChange={setTab} options={[{ key: 'Requests', label: 'Requests', count: sorted?.length }, { key: 'Balance', label: 'Balance' }]} />
      {tab === 'Balance' && (balances.data ? <View style={styles.balance}><AppText variant="caption" tone="muted">{balances.data.year.name} · approved leave is taken, pending leave is still asked for</AppText>
        {balances.data.balances.length === 0 ? <Notice message="No leave types are configured yet. Requests can be made without a type." /> : <StatRow>{balances.data.balances.map(b => <StatTile key={b.typeId} value={b.tracksBalance ? fmt(b.remaining) : '∞'} label={b.name} note={b.tracksBalance ? `${fmt(b.used)} taken · ${fmt(b.pending)} pending` : 'Not tracked'} tone={b.tracksBalance && (b.remaining ?? 0) <= 0 ? 'warning' : 'default'} />)}</StatRow>}</View> : <View style={styles.balance}><Skeleton width="60%" /></View>)}</>}
    empty={tab === 'Requests' ? { icon: 'document-text-outline', title: 'No leave requests', message: 'Use "Request leave" to raise one.' } : { icon: 'wallet-outline', title: 'Balance', message: 'Your balances are shown above.' }}
    row={(item, index, all) => <ListItem icon="document-text-outline" title={dayRange(item.fromDate, item.toDate) + (item.halfDay && item.halfDay !== 'No' ? ' · ' + item.halfDay.toLowerCase() : '')} subtitle={item.reason} meta={`${fmt(item.days ?? leaveDaysOf(item.fromDate, item.toDate, item.halfDay))} day(s)`} last={index === all.length - 1} onPress={() => { setFailure(''); setOpen(item) }} trailing={<Badge label={item.status} tone={tone(item.status)} />} />} />
    <Sheet visible={!!open} title="Leave request" onClose={() => setOpen(null)} footer={open?.status === 'Pending' && mayRequest ? <Button label="Withdraw request" variant="danger" loading={cancel.isPending} onPress={() => withdraw(open)} /> : undefined}>
      {open && <><AppText variant="caption" tone="primary">{dayRange(open.fromDate, open.toDate)} · {fmt(open.days ?? leaveDaysOf(open.fromDate, open.toDate, open.halfDay))} day(s) · {open.status}</AppText><AppText>{open.reason}</AppText>
        {!!open.approvalRemark && <Notice message={'Remark: ' + open.approvalRemark} />}{!!failure && <Notice tone="danger" message={failure} />}</>}
    </Sheet>
    <Sheet visible={!!form} title="Request leave" onClose={() => setForm(null)} footer={<Button label="Send request" icon="send" loading={request.isPending} disabled={!form || form.reason.trim().length === 0 || (types.length > 0 && !form.typeId)} onPress={send} />}>
      {form && <>
        {types.length > 0 && <><AppText variant="label" tone="muted">Leave type</AppText><Chips value={form.typeId} onChange={typeId => setForm({ ...form, typeId })} wrap options={types.map(t => ({ key: t.typeId, label: t.name + (t.tracksBalance ? ' · ' + fmt(t.afterPending) + ' left' : '') }))} /></>}
        <AppText variant="label" tone="muted">Half day</AppText><Chips value={form.halfDay} onChange={halfDay => setForm({ ...form, halfDay })} options={[{ key: 'No', label: 'Full day' }, { key: 'First half', label: 'First half' }, { key: 'Second half', label: 'Second half' }]} />
        <AppText variant="label" tone="muted">From</AppText><Stepper label={dayParts(form.fromDate)?.label ?? form.fromDate} previousDisabled={form.fromDate <= today} onPrevious={() => setForm({ ...form, fromDate: shiftDay(form.fromDate, -1) })} onNext={() => { const fromDate = shiftDay(form.fromDate, 1); setForm({ ...form, fromDate, toDate: form.toDate < fromDate ? fromDate : form.toDate }) }} />
        {form.halfDay === 'No' && <><AppText variant="label" tone="muted">To</AppText><Stepper label={dayParts(form.toDate)?.label ?? form.toDate} previousDisabled={form.toDate <= form.fromDate} onPrevious={() => setForm({ ...form, toDate: shiftDay(form.toDate, -1) })} onNext={() => setForm({ ...form, toDate: shiftDay(form.toDate, 1) })} /></>}
        <AppText variant="caption" tone="muted">{fmt(leaveDaysOf(form.fromDate, form.halfDay === 'No' ? form.toDate : form.fromDate, form.halfDay))} day(s)</AppText>
        <TextField label="Reason" value={form.reason} onChangeText={reason => setForm({ ...form, reason })} multiline maxLength={1000} placeholder="Why you need this leave" style={{ minHeight: 90, textAlignVertical: 'top' }} />
        {!!failure && <Notice tone="danger" message={failure} />}</>}
    </Sheet></>
}

function LeadershipLeave() {
  const mayApprove = usePermission('leave-requests.approve'), mayCover = usePermission('substitutions.manage'), mayOperate = usePermission('substitutions.view')
  const queue = useLeaveQueue(), name = useNames(), decide = useDecideLeave(), today = isoDay(new Date()), ops = useOperations(today, mayOperate)
  const [tab, setTab] = useState('Pending'), [open, setOpen] = useState<string | null>(null), [remark, setRemark] = useState(''), [failure, setFailure] = useState(''), [cover, setCover] = useState<Period | null>(null)
  const item = queue.data?.items.find(i => i.id === open), impact = useLeaveImpact(open ?? undefined)
  const close = () => { setOpen(null); setRemark(''); setFailure('') }
  const settle = (decision: 'Approved' | 'Rejected') => { if (!item) return; setFailure('')
    decide.mutate({ id: item.id, version: item.version, decision, remark: remark.trim() }, { onSuccess: close, onError: error => setFailure(normalizeError(error).message) }) }
  const reject = () => { if (!remark.trim()) { setFailure('Give a reason when rejecting leave.'); return } Alert.alert('Reject this leave request?', 'The staff member will see it as rejected.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Reject', style: 'destructive', onPress: () => settle('Rejected') }]) }
  const items = tab === 'Pending' ? queue.data?.items : tab === 'Today' ? ops.data?.periods : []
  return <><ListScreen source={tab === 'Today' ? ops : queue} items={items as (typeof queue.data extends { items: infer T } ? T : never) | undefined} keyOf={(i: { id: string }) => i.id}
    top={<><Header overline="Staff" title="Leave approvals" route="/leave" />
      <Chips value={tab} onChange={setTab} options={[{ key: 'Pending', label: 'Awaiting decision', count: queue.data?.total }, ...(mayOperate ? [{ key: 'Today', label: 'Cover today', count: ops.data?.summary.uncovered }] : [])]} />
      {tab === 'Today' && ops.data && <View style={styles.balance}><AppText variant="caption" tone="muted">{ops.data.summary.away} away · {impactWord(ops.data.summary)}</AppText></View>}</>}
    empty={tab === 'Pending' ? { icon: 'document-text-outline', title: 'Nothing waiting', message: 'Leave requests from staff will appear here for a decision.' } : { icon: 'time-outline', title: 'Every lesson has its teacher', message: 'No lesson today is affected by an absence.' }}
    row={(row: Record<string, unknown>, index: number, all: unknown[]) => tab === 'Today'
      ? <ListItem icon="time-outline" title={`${row.startsAt}–${row.endsAt} · ${row.className}`} subtitle={`${row.subjectName} · usually ${row.teacherName}`} meta={row.status === 'covered' ? 'Covered by ' + (row.substitution as { teacherName: string } | undefined)?.teacherName : 'Needs cover'} last={index === all.length - 1}
        trailing={<Badge label={row.status === 'covered' ? 'Covered' : 'Needs cover'} tone={row.status === 'covered' ? 'success' : 'warning'} />} onPress={mayCover ? () => setCover(row as unknown as Period) : undefined} />
      : <ListItem icon="document-text-outline" title={String(row.teacherName) || 'Staff member'} subtitle={String(row.reason)} meta={dayRange(String(row.fromDate), String(row.toDate)) + ' · ' + fmt(row.days as number) + ' day(s)' + (row.typeName ? ' · ' + row.typeName : '') + ' · ' + impactWord(row.impact as { affected: number, covered: number, uncovered: number })} last={index === all.length - 1}
        onPress={() => { setFailure(''); setOpen(String(row.id)) }} trailing={<Badge label={(row.impact as { uncovered: number }).uncovered ? (row.impact as { uncovered: number }).uncovered + ' uncovered' : 'Pending'} tone={(row.impact as { uncovered: number }).uncovered ? 'warning' : 'neutral'} />} />} />
    <Sheet visible={!!item} title={item?.teacherName ?? 'Leave request'} onClose={close}
      footer={item && mayApprove ? <><Button label="Approve" icon="checkmark" loading={decide.isPending} onPress={() => settle('Approved')} /><Button label="Reject" variant="danger" disabled={decide.isPending} onPress={reject} /></> : undefined}>
      {item && <><AppText variant="caption" tone="primary">{dayRange(item.fromDate, item.toDate)}{item.halfDay && item.halfDay !== 'No' ? ' · ' + item.halfDay.toLowerCase() : ''} · {fmt(item.days)} day(s) · {item.typeName || 'No type'}{item.tracksBalance ? ' · ' + fmt(item.remaining) + ' left' : ''}</AppText><AppText>{item.reason}</AppText>
        <AppText variant="label" tone="muted">Timetable impact</AppText>
        {impact.data ? impact.data.periods.length === 0 ? <AppText variant="caption" tone="muted">No lessons affected.</AppText> : impact.data.periods.map(p => <AppText key={p.id + p.date} variant="caption" tone={p.status === 'uncovered' ? 'danger' : 'muted'}>{p.date} · {p.startsAt}–{p.endsAt} · {p.className} · {p.subjectName} · {p.status === 'covered' ? 'covered by ' + p.substitution?.teacherName : 'needs cover'}</AppText>) : <Skeleton width="80%" />}
        {mayApprove && <TextField label="Remark" value={remark} onChangeText={setRemark} maxLength={500} placeholder="Required when rejecting" />}
        {!!failure && <Notice tone="danger" message={failure} />}</>}
    </Sheet>
    {cover && <CoverSheet period={cover} date={today} onClose={() => setCover(null)} />}</>
}

function CoverSheet({ period, date, onClose }: { period: Period, date: string, onClose: () => void }) {
  const candidates = useCandidates(period.id, date), assign = useAssignSubstitute(), [teacherId, setTeacherId] = useState(period.substitution?.teacherId ?? ''), [failure, setFailure] = useState('')
  const free = candidates.data?.candidates.filter(c => c.free) ?? [], busy = candidates.data?.candidates.filter(c => !c.free) ?? []
  const save = () => { setFailure(''); assign.mutate({ date, timetableId: period.id, teacherId, existing: period.substitution }, { onSuccess: onClose, onError: error => setFailure(normalizeError(error).message) }) }
  return <Sheet visible title={`Cover ${period.className} · ${period.subjectName}`} onClose={onClose} footer={<Button label={period.substitution ? 'Change substitute' : 'Assign substitute'} icon="person-add" loading={assign.isPending} disabled={!teacherId} onPress={save} />}>
    <AppText variant="caption" tone="muted">{date} · {period.startsAt}–{period.endsAt}{period.room ? ' · Room ' + period.room : ''} · usually {period.teacherName}</AppText>
    {candidates.data ? <>{free.length === 0 ? <Notice tone="warning" message="No teacher is free at that time." /> : <Chips value={teacherId} onChange={setTeacherId} wrap options={free.map(c => ({ key: c.teacherId, label: c.name + (c.teachesSubject ? ' · subject' : c.teachesClass ? ' · class' : '') }))} />}
      {busy.length > 0 && <AppText variant="caption" tone="muted">Not available: {busy.map(c => c.name).join(', ')}</AppText>}</> : <Skeleton width="70%" />}
    {!!failure && <Notice tone="danger" message={failure} />}
  </Sheet>
}
const styles = StyleSheet.create({ balance: { gap: 8, marginBottom: 8 } })
