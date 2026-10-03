import { useState } from 'react'
import { Alert } from 'react-native'
import { experienceFor } from '@/access/experience'
import { normalizeError } from '@/api/errors'
import { Chips, Header, LinkText, ListItem, Sheet, Stepper } from '@/components/blocks'
import { ListScreen } from '@/components/ListScreen'
import { AppText, Badge, Button, Notice, TextField } from '@/components/ui'
import { useSession } from '@/services'
import { dayParts, dayRange, isoDay } from '@/utils/format'
import { useDecideLeave, useLeave, useNames, usePermission, useRequestLeave } from '../data'
import { leaveDays, shiftDay, type Leave } from '../logic'

// Staff leave. A teacher sees and raises their own requests; leadership sees every request and decides the pending
// ones. Both use the leave-request records the web uses, and the server applies the same rules (no overlapping leave,
// only leadership may approve, a request already decided by someone else is not overwritten).
const tone = (status: string) => status === 'Approved' ? 'success' as const : status === 'Rejected' ? 'danger' as const : 'warning' as const

export function LeaveScreen() {
  const user = useSession(state => state.user), leadership = experienceFor(user) === 'principal', mayManage = usePermission('leave-requests.manage')
  const leave = useLeave(), name = useNames(), decide = useDecideLeave(), request = useRequestLeave(), today = isoDay(new Date())
  const [tab, setTab] = useState('Pending'), [open, setOpen] = useState<Leave | null>(null), [remark, setRemark] = useState(''), [failure, setFailure] = useState('')
  const [form, setForm] = useState<{ fromDate: string, toDate: string, reason: string } | null>(null)
  const sorted = leave.data && [...leave.data].sort((a, b) => b.fromDate.localeCompare(a.fromDate)), pending = sorted?.filter(item => item.status === 'Pending'), decided = sorted?.filter(item => item.status !== 'Pending')
  const myStaffId = name.list('teachers')[0]?.id
  const close = () => { setOpen(null); setRemark(''); setFailure('') }
  const settle = (status: 'Approved' | 'Rejected') => { if (!open) return; setFailure('')
    decide.mutate({ leave: open, status, remark: remark.trim() }, { onSuccess: close, onError: error => setFailure(normalizeError(error).message) }) }
  const reject = () => Alert.alert('Reject this leave request?', 'The staff member will see it as rejected.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Reject', style: 'destructive', onPress: () => settle('Rejected') }])
  const send = () => { if (!form || !myStaffId) return; setFailure('')
    request.mutate({ teacherId: myStaffId, ...form, reason: form.reason.trim() }, { onSuccess: () => { setForm(null); setTab('Pending') }, onError: error => setFailure(normalizeError(error).message) }) }
  return <><ListScreen source={leave} items={tab === 'Pending' ? pending : decided} keyOf={item => item.id}
    top={<><Header overline="Staff" title={leadership ? 'Leave approvals' : 'My leave'} route="/leave" right={!leadership && mayManage ? <LinkText label="Request leave" onPress={() => { setFailure(''); setForm({ fromDate: today, toDate: today, reason: '' }) }} /> : undefined} />
      <Chips value={tab} onChange={setTab} options={[{ key: 'Pending', label: leadership ? 'Awaiting decision' : 'Pending', count: pending?.length }, { key: 'Decided', label: 'Decided', count: decided?.length }]} /></>}
    empty={tab === 'Pending' ? { icon: 'document-text-outline', title: leadership ? 'Nothing waiting' : 'No pending requests', message: leadership ? 'Leave requests from staff will appear here for a decision.' : 'Use "Request leave" to raise one.' } : { icon: 'document-text-outline', title: 'No decided requests', message: 'Approved and rejected requests are listed here.' }}
    row={(item, index, all) => <ListItem icon="document-text-outline" title={leadership ? name('teachers', item.teacherId) || 'Staff member' : dayRange(item.fromDate, item.toDate)} subtitle={item.reason}
      meta={(leadership ? dayRange(item.fromDate, item.toDate) + ' · ' : '') + `${leaveDays(item.fromDate, item.toDate)} day${leaveDays(item.fromDate, item.toDate) === 1 ? '' : 's'}`} last={index === all.length - 1} onPress={() => { setFailure(''); setOpen(item) }} trailing={<Badge label={item.status} tone={tone(item.status)} />} />} />
    <Sheet visible={!!open} title={open ? (name('teachers', open.teacherId) || 'Leave request') : ''} onClose={close}
      footer={open && leadership && mayManage && open.status === 'Pending' ? <><Button label="Approve" icon="checkmark" loading={decide.isPending} onPress={() => settle('Approved')} /><Button label="Reject" variant="danger" disabled={decide.isPending} onPress={reject} /></> : undefined}>
      {open && <><AppText variant="caption" tone="primary">{dayRange(open.fromDate, open.toDate)} · {leaveDays(open.fromDate, open.toDate)} day(s) · {open.status}</AppText><AppText>{open.reason}</AppText>
        {!!open.approvalRemark && <Notice message={'Remark: ' + open.approvalRemark} />}
        {leadership && mayManage && open.status === 'Pending' && <TextField label="Remark (optional)" value={remark} onChangeText={setRemark} maxLength={500} placeholder="A note for the staff member" />}
        {!!failure && <Notice tone="danger" message={failure} />}</>}
    </Sheet>
    <Sheet visible={!!form} title="Request leave" onClose={() => setForm(null)} footer={<Button label="Send request" icon="send" loading={request.isPending} disabled={!form || form.reason.trim().length === 0 || !myStaffId} onPress={send} />}>
      {form && <>{!myStaffId && name.ready && <Notice tone="warning" message="Your account is not linked to a staff profile yet, so leave cannot be requested here. Ask the school office." />}
        <AppText variant="label" tone="muted">From</AppText><Stepper label={dayParts(form.fromDate)?.label ?? form.fromDate} previousDisabled={form.fromDate <= today} onPrevious={() => setForm({ ...form, fromDate: shiftDay(form.fromDate, -1) })} onNext={() => { const fromDate = shiftDay(form.fromDate, 1); setForm({ ...form, fromDate, toDate: form.toDate < fromDate ? fromDate : form.toDate }) }} />
        <AppText variant="label" tone="muted">To</AppText><Stepper label={dayParts(form.toDate)?.label ?? form.toDate} previousDisabled={form.toDate <= form.fromDate} onPrevious={() => setForm({ ...form, toDate: shiftDay(form.toDate, -1) })} onNext={() => setForm({ ...form, toDate: shiftDay(form.toDate, 1) })} />
        <AppText variant="caption" tone="muted">{leaveDays(form.fromDate, form.toDate)} day(s)</AppText>
        <TextField label="Reason" value={form.reason} onChangeText={reason => setForm({ ...form, reason })} multiline maxLength={1000} placeholder="Why you need this leave" style={{ minHeight: 90, textAlignVertical: 'top' }} />
        {!!failure && <Notice tone="danger" message={failure} />}</>}
    </Sheet></>
}
