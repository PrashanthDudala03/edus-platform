import { useState } from 'react'
import { Alert, View } from 'react-native'
import { normalizeError } from '@/api/errors'
import { Chips, Header, ListItem, Sheet, StatRow, StatTile } from '@/components/blocks'
import { ListScreen } from '@/components/ListScreen'
import { AppText, Badge, Button, Notice, Skeleton, TextField } from '@/components/ui'
import { dayParts } from '@/utils/format'
import { useAdmission, useAdmissionDecision, useAdmissionsPipeline, usePermission } from '../data'
import { admissionGroup, admissionTone, mobileDecisions, ADMISSION_GROUPS } from '../admissions'

// Admissions for school leadership on the phone: the pipeline at a glance, the applications waiting for a decision,
// and each applicant's summary with onboarding blockers. Approving, rejecting and waitlisting follow the account's
// permissions; the admission form, onboarding steps and activation stay on the web.
export function AdmissionsScreen() {
  const pipeline = useAdmissionsPipeline(), mayApprove = usePermission('admissions.approve'), mayManage = usePermission('admissions.manage')
  const [group, setGroup] = useState<string>('Decide'), [open, setOpen] = useState<string | null>(null)
  const items = pipeline.data?.items.filter(i => admissionGroup(i.status) === group), counts = pipeline.data?.counts
  return <><ListScreen source={pipeline} items={items} keyOf={i => i.id}
    top={<><Header overline="Admissions" title="Applications" route="/admissions" />
      {counts && <StatRow><StatTile value={String((counts.Submitted ?? 0) + (counts['Under Review'] ?? 0) + (counts.Waitlisted ?? 0))} label="To decide" /><StatTile value={String((counts.Approved ?? 0) + (counts.Onboarding ?? 0))} label="Onboarding" /><StatTile value={String(counts.Ready ?? 0)} label="Ready" /></StatRow>}
      <Chips value={group} onChange={setGroup} options={ADMISSION_GROUPS.map(g => ({ key: g.key, label: g.label, count: pipeline.data?.items.filter(i => admissionGroup(i.status) === g.key).length }))} /></>}
    empty={{ icon: 'school-outline', title: 'Nothing here', message: group === 'Decide' ? 'Applications waiting for a decision appear here.' : 'Applications in this stage appear here.' }}
    row={(item, index, all) => <ListItem icon="school-outline" title={item.name} subtitle={(item.className || 'No class') + ' · ' + item.applicationNumber} meta={item.duplicates ? 'Possible duplicate' : 'Documents ' + item.documents.verified + '/' + item.documents.required}
      trailing={<Badge label={item.status} tone={admissionTone(item.status)} />} last={index === all.length - 1} onPress={() => setOpen(item.id)} />} />
    {open && <Applicant id={open} mayApprove={mayApprove} mayManage={mayManage} onClose={() => setOpen(null)} />}</>
}

function Applicant({ id, mayApprove, mayManage, onClose }: { id: string, mayApprove: boolean, mayManage: boolean, onClose: () => void }) {
  const detail = useAdmission(id), decide = useAdmissionDecision(), [reason, setReason] = useState(''), [ack, setAck] = useState(false), [failure, setFailure] = useState('')
  const d = detail.data, actions = d ? mobileDecisions(d.status, { approve: mayApprove, manage: mayManage }) : []
  const run = (to: string, needsReason: boolean) => {
    if (!d) return; setFailure('')
    if (needsReason && !reason.trim()) { setFailure('Give a reason for this decision.'); return }
    const go = () => decide.mutate({ id, to, reason: reason.trim(), version: d.version, acknowledgeDuplicates: ack }, { onSuccess: onClose, onError: e => setFailure(normalizeError(e).message) })
    if (to === 'Rejected') Alert.alert('Reject this application?', 'The office will see the reason; the family is not told it here.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Reject', style: 'destructive', onPress: go }]); else go()
  }
  return <Sheet visible title={d?.name ?? 'Application'} onClose={onClose} footer={actions.length ? <View style={{ gap: 8 }}>{actions.map(a => <Button key={a.to} label={a.label} variant={a.to === 'Rejected' ? 'danger' : a.primary ? 'primary' : 'secondary'} loading={decide.isPending} disabled={a.to === 'Approved' && (d?.duplicates.length ?? 0) > 0 && !ack} onPress={() => run(a.to, a.reason)} />)}</View> : undefined}>
    {!d ? <Skeleton width="70%" /> : <>
      <AppText variant="caption" tone="primary">{d.applicationNumber} · {d.status} · {d.className || 'No class'}{d.yearName ? ' · ' + d.yearName : ''}</AppText>
      <AppText>Guardian {d.guardianName}{d.submittedAt ? ' · submitted ' + (dayParts(d.submittedAt)?.label ?? '') : ''}</AppText>
      <AppText variant="caption" tone="muted">Born {dayParts(d.application.dateOfBirth)?.label ?? '—'}{d.application.previousSchool ? ' · from ' + d.application.previousSchool : ''}</AppText>
      {d.duplicates.length > 0 && <Notice tone="warning" message={'Possible duplicate: ' + d.duplicates.map(x => x.label + ' (' + x.reasons.join(', ') + ')').join('; ') + '. Nothing is merged automatically.'} />}
      {d.duplicates.length > 0 && actions.some(a => a.to === 'Approved') && <Chips value={ack ? 'yes' : 'no'} onChange={v => setAck(v === 'yes')} options={[{ key: 'no', label: 'Not reviewed' }, { key: 'yes', label: 'Reviewed: a different child' }]} />}
      {(d.status === 'Onboarding' || d.status === 'Ready') && <Notice tone={d.onboarding.blockers.length ? 'warning' : 'info'} message={d.onboarding.blockers.length ? 'Blocking activation: ' + d.onboarding.blockers.join(' ') : 'Ready to activate on the web.'} />}
      {actions.some(a => a.reason) && <TextField label="Reason" value={reason} onChangeText={setReason} maxLength={1000} placeholder="Needed to reject, waitlist or withdraw" />}
      {!!failure && <Notice tone="danger" message={failure} />}</>}
  </Sheet>
}
