import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { experienceFor } from '@/access/experience'
import { Chips, Group, Header, ListItem, StatRow, StatTile } from '@/components/blocks'
import { QueryView } from '@/components/QueryView'
import { AppText, Avatar, Badge, Button, Card, EmptyState, Notice, Screen, TextField } from '@/components/ui'
import { useSession } from '@/services'
import { color, space } from '@/theme/tokens'
import { dayParts, initials } from '@/utils/format'
import { useChildren, useNames, useStudent360, useStudent360Timeline } from '../data'
import { GROUP_LABEL, S360_TAB_LABEL, componentsLabel, pctLabel, resultLabel, s360AttendanceNote, s360EventIcon, s360EventsByDay, s360ExamsNote, s360FeesNote, s360HomeworkNote, s360Tabs, type HomeworkGroup, type S360Event, type S360Tab, type Student360 } from '../logic'

// Student 360: "what is happening with this student?" in one place. A student opens their own profile, a parent
// picks a child, staff find a student of their classes (leadership: any student). One request composes the picture
// on the server, with what the role may see already decided; the sections only lay it out.
export function Student360Screen() {
  const user = useSession(state => state.user), experience = experienceFor(user), family = experience === 'parent' || experience === 'student'
  const children = useChildren(undefined, family), names = useNames(!family), [chosen, setChosen] = useState(''), [search, setSearch] = useState('')
  const staffStudents = names.list('students'), picks = family ? (children.data ?? []).map(c => ({ id: c.studentId, label: c.name })) : staffStudents
  const current = picks.find(p => p.id === chosen) ?? (family || picks.length === 1 ? picks[0] : undefined)
  return <Screen>
    <Header overline={experience === 'student' ? 'My record' : experience === 'parent' ? 'My family' : 'Students'} title={experience === 'student' ? 'My school profile' : 'Student 360'} route="/student360" />
    {family && (children.data?.length ?? 0) > 1 && <Chips value={current?.id ?? ''} onChange={setChosen} options={picks.map(p => ({ key: p.id, label: p.label.split(' ')[0] }))} />}
    {!family && picks.length > 1 && <View style={styles.find}><TextField label="Find a student" value={search} onChangeText={setSearch} placeholder="Name" />
      {!current && <Group>{picks.filter(p => p.label.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 30).map((p, i, all) => <ListItem key={p.id} leading={<Avatar label={initials(p.label)} size={36} />} title={p.label} onPress={() => setChosen(p.id)} last={i === all.length - 1} />)}</Group>}
      {!!current && <Button label="Another student" variant="secondary" onPress={() => { setChosen(''); setSearch('') }} />}</View>}
    {family && children.allowed && children.data?.length === 0 && <EmptyState icon="people-outline" title={experience === 'student' ? 'Your student record is not linked yet' : 'No children linked yet'} message="Ask the school office to link this account to the student record." />}
    {!family && names.ready && picks.length === 0 && <EmptyState icon="people-outline" title="No students in your scope" message="Students appear once classes are assigned to you." />}
    {!!current && <Picture studentId={current.id} />}
  </Screen>
}

function Picture({ studentId }: { studentId: string }) {
  const view = useStudent360(studentId), [tab, setTab] = useState<S360Tab>('overview')
  return <QueryView query={view} empty={{ title: 'Nothing to show', message: '' }}>{v => { const tabs = s360Tabs(v.visibility), active = tabs.includes(tab) ? tab : 'overview'; return <>
    <Card style={styles.identity}><Avatar label={initials(v.student.name)} size={56} background={color.primary} foreground={color.onPrimary} />
      <View style={styles.flex}><AppText variant="title" numberOfLines={2}>{v.student.name}</AppText><AppText variant="caption" tone="muted" numberOfLines={2}>{[v.student.admissionNumber && 'Admission ' + v.student.admissionNumber, v.student.className || 'Class not allocated', v.student.year].filter(Boolean).join(' · ')}</AppText>
        <View style={styles.chips}><Badge label={v.student.status || 'Status unknown'} tone={v.student.status === 'Active' ? 'success' : 'neutral'} />{v.student.guardians.filter(g => g.relationship === 'parent').map(g => <Badge key={g.name} label={'Guardian: ' + g.name} />)}</View>
        {v.visibility.contact && !!(v.student.email || v.student.phone) && <AppText variant="caption" tone="muted">{[v.student.email, v.student.phone].filter(Boolean).join(' · ')}</AppText>}</View></Card>
    <Chips value={active} onChange={value => setTab(value as S360Tab)} options={tabs.map(t => ({ key: t, label: S360_TAB_LABEL[t] }))} />
    {active === 'overview' && <Overview v={v} go={setTab} />}
    {active === 'academics' && <Academics v={v} />}
    {active === 'attendance' && <Attendance v={v} />}
    {active === 'homework' && <Homework v={v} />}
    {active === 'exams' && <Exams v={v} />}
    {active === 'fees' && <Fees v={v} />}
    {active === 'documents' && <Documents v={v} />}
    {active === 'timeline' && <Timeline v={v} studentId={studentId} />}
  </> }}</QueryView>
}

function Overview({ v, go }: { v: Student360, go: (t: S360Tab) => void }) {
  const a = v.attendance.thisMonth, f = v.fees
  return <>
    <StatRow><StatTile value={pctLabel(a.percent)} label="Attendance" note={s360AttendanceNote(a)} onPress={() => go('attendance')} /><StatTile value={pctLabel(v.homework.completion)} label="Homework" note={s360HomeworkNote(v.homework)} tone={(v.homework.counts.missing ?? 0) > 0 ? 'warning' : 'default'} onPress={() => go('homework')} /></StatRow>
    <StatRow><StatTile value={v.exams.published ? pctLabel(v.exams.percent) : '—'} label="Results" note={s360ExamsNote(v.exams)} onPress={() => go('exams')} />{f.available ? <StatTile value={f.charges ? f.currency + ' ' + f.outstanding.toLocaleString('en-IN') : '—'} label="Outstanding fees" note={s360FeesNote(f)} tone={f.outstanding > 0 ? 'warning' : 'default'} onPress={() => go('fees')} /> : <StatTile value="—" label="Fees" note={f.reason} />}</StatRow>
    <Group title="Upcoming exams">{v.exams.upcoming.length === 0 ? <ListItem icon="school-outline" title="No upcoming exams" last /> : v.exams.upcoming.map((e, i, all) => <ListItem key={e.id} icon="school-outline" title={e.name + ' · ' + e.subjectName} meta={(dayParts(e.date)?.label ?? e.date) + (e.startsAt ? ' · ' + e.startsAt : '') + (e.room ? ' · ' + e.room : '')} last={i === all.length - 1} />)}</Group>
    <Group title="Homework due">{v.homework.due.length === 0 ? <ListItem icon="book-outline" title="Nothing due" last /> : v.homework.due.map((h, i, all) => <ListItem key={h.id} icon="book-outline" title={h.title} subtitle={h.subject} meta={'Due ' + (dayParts(h.dueDate)?.label ?? h.dueDate)} trailing={<Badge label={GROUP_LABEL[h.group as HomeworkGroup] ?? h.group} tone={h.group === 'missing' ? 'danger' : 'neutral'} />} last={i === all.length - 1} />)}</Group>
    <Group title="Recent notices">{v.notices.length === 0 ? <ListItem icon="megaphone-outline" title="No notices yet" last /> : v.notices.map((n, i, all) => <ListItem key={n.id} icon="megaphone-outline" title={n.title} meta={dayParts(n.createdAt)?.label} last={i === all.length - 1} />)}</Group>
    <Group title="Latest activity" action={undefined}>{v.timeline.items.length === 0 ? <ListItem icon="time-outline" title="Nothing recorded yet" last /> : v.timeline.items.slice(0, 5).map((e, i, all) => <EventRow key={i} e={e} last={i === all.length - 1} />)}</Group>
    {!v.academics.allocated && <Notice tone="warning" message="Not allocated to a class yet, so homework, exams and subjects cannot be shown." />}
  </>
}
function Academics({ v }: { v: Student360 }) {
  const a = v.academics
  return <>
    <Group title="Enrolment"><ListItem title="Academic year" trailing={<AppText>{a.year || '—'}</AppText>} /><ListItem title="Class" trailing={<AppText>{a.className || '—'}</AppText>} /><ListItem title="Section" trailing={<AppText>{a.section || '—'}</AppText>} /><ListItem title="Class teacher" trailing={<AppText>{a.classTeacher || '—'}</AppText>} last /></Group>
    <Group title="Subjects and teachers">{a.subjects.length === 0 ? <ListItem title="No subjects assigned" last /> : a.subjects.map((s, i, all) => <ListItem key={i} title={s.subject} subtitle={s.teacher || undefined} last={i === all.length - 1} />)}</Group>
  </>
}
function Attendance({ v }: { v: Student360 }) {
  const a = v.attendance
  const row = (s: Student360['attendance']['year'], title: string) => <Group title={title}><View style={styles.pad}><AppText variant="title" tone="primary">{pctLabel(s.percent)}</AppText><AppText variant="caption" tone="muted">{s360AttendanceNote(s)}</AppText>
    <View style={styles.chips}><Badge label={`Present ${s.present}`} tone="success" /><Badge label={`Late ${s.late}`} tone="warning" /><Badge label={`Absent ${s.absent}`} tone="danger" /><Badge label={`Excused ${s.excused}`} /></View></View></Group>
  return <>{row(a.thisMonth, 'This month')}{row(a.year, `Academic year · ${a.from} to ${a.to}`)}
    <Group title="Recent marked days">{a.recent.length === 0 ? <ListItem title="No days marked yet" last /> : a.recent.map((d, i, all) => <ListItem key={d.day} title={dayParts(String(d.day).slice(0, 10))?.label ?? String(d.day).slice(0, 10)} subtitle={[d.reason, d.remark].filter(Boolean).join(': ') || undefined} trailing={<Badge label={d.status} tone={d.status === 'Present' ? 'success' : d.status === 'Absent' ? 'danger' : d.status === 'Late' ? 'warning' : 'neutral'} />} last={i === all.length - 1} />)}</Group></>
}
function Homework({ v }: { v: Student360 }) {
  const h = v.homework
  return <>
    <View style={styles.chips}>{(['due-today', 'upcoming', 'missing', 'late', 'submitted', 'reviewed', 'excused'] as HomeworkGroup[]).map(g => <Badge key={g} label={`${GROUP_LABEL[g]} ${h.counts[g] ?? 0}`} tone={g === 'missing' && (h.counts[g] ?? 0) > 0 ? 'danger' : 'neutral'} />)}</View>
    <AppText variant="caption" tone="muted">{h.assigned} set · completion {pctLabel(h.completion)}</AppText>
    <Group title="Due and missing">{h.due.length === 0 ? <ListItem icon="book-outline" title="Nothing due" last /> : h.due.map((x, i, all) => <ListItem key={x.id} icon="book-outline" title={x.title} subtitle={x.subject} meta={'Due ' + (dayParts(x.dueDate)?.label ?? x.dueDate) + (x.dueTime ? ' ' + x.dueTime : '')} trailing={<Badge label={GROUP_LABEL[x.group as HomeworkGroup] ?? x.group} tone={x.group === 'missing' ? 'danger' : 'neutral'} />} last={i === all.length - 1} />)}</Group>
    <Group title="Recent teacher feedback">{h.feedback.length === 0 ? <ListItem title="No feedback yet" last /> : h.feedback.map((x, i, all) => <ListItem key={i} title={x.title + (x.grade ? ' · ' + x.grade : '')} subtitle={[x.subject, x.feedback].filter(Boolean).join(' · ')} meta={dayParts(x.reviewedAt.slice(0, 10))?.label} last={i === all.length - 1} />)}</Group>
  </>
}
function Exams({ v }: { v: Student360 }) {
  const e = v.exams
  return <>
    <StatRow><StatTile value={e.published ? pctLabel(e.percent) : '—'} label="Overall" note={e.published ? `${e.obtained} of ${e.maximum} marks` : 'No published results yet'} /><StatTile value={e.published ? e.grade : '—'} label="Grade" note={e.published ? `${e.passed} passed · ${e.failed} below pass` : 'Published exams only'} /></StatRow>
    <Group title="Latest published results">{e.latest.length === 0 ? <ListItem icon="ribbon-outline" title="No published results yet" subtitle="Nothing unpublished is ever shown here." last /> : e.latest.map((r, i, all) => <ListItem key={i} icon="document-text-outline" title={r.subject} subtitle={[r.exam, r.term, componentsLabel(r.components)].filter(Boolean).join(' · ')} trailing={<View style={styles.score}><AppText variant="bodyStrong">{resultLabel(r)}</AppText><Badge label={r.status === 'Exempt' ? 'Exempt' : r.pass ? 'Pass' : 'Below pass'} tone={r.status === 'Exempt' ? 'neutral' : r.pass ? 'success' : 'danger'} /></View>} last={i === all.length - 1} />)}</Group>
    <Group title="Upcoming exams">{e.upcoming.length === 0 ? <ListItem icon="school-outline" title="No upcoming exams" last /> : e.upcoming.map((x, i, all) => <ListItem key={x.id} icon="school-outline" title={x.name + ' · ' + x.subjectName} meta={(dayParts(x.date)?.label ?? x.date) + (x.startsAt ? ' · ' + x.startsAt + (x.endsAt ? '–' + x.endsAt : '') : '') + (x.room ? ' · ' + x.room : '')} last={i === all.length - 1} />)}</Group>
    <AppText variant="caption" tone="faint">The printable report card is on the EduOS web portal.</AppText>
  </>
}
function Fees({ v }: { v: Student360 }) {
  const f = v.fees
  if (!f.available) return <EmptyState icon="wallet-outline" title="Fees are not shown here" message={f.reason} />
  const m = (n: number) => f.currency + ' ' + n.toLocaleString('en-IN')
  return <>
    <StatRow><StatTile value={f.charges ? m(f.applicable) : '—'} label="Applicable" note={`${f.charges} charges`} /><StatTile value={f.charges ? m(f.paid) : '—'} label="Paid" /><StatTile value={f.charges ? m(f.outstanding) : '—'} label="Outstanding" note={s360FeesNote(f)} tone={f.outstanding > 0 ? 'warning' : 'default'} /></StatRow>
    <Group title="Recent payments">{f.recentPayments.length === 0 ? <ListItem icon="wallet-outline" title="No payments yet" last /> : f.recentPayments.map((p, i, all) => <ListItem key={p.id} icon="wallet-outline" title={m(p.amount)} subtitle={p.description + ' · ' + p.method} meta={String(p.paidOn).slice(0, 10) + ' · ' + p.receipt} last={i === all.length - 1} />)}</Group>
  </>
}
function Documents({ v }: { v: Student360 }) {
  return <Group title="Certificates and documents">{v.documents.length === 0 ? <ListItem icon="document-text-outline" title="No documents yet" last /> : v.documents.map((d, i, all) => <ListItem key={d.id} icon="document-text-outline" title={d.type} subtitle={[d.number, d.files ? `${d.files} file${d.files === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') || undefined} meta={'Issued ' + (dayParts(d.issuedOn)?.label ?? d.issuedOn)} last={i === all.length - 1} />)}</Group>
}
function EventRow({ e, last }: { e: S360Event, last: boolean }) {
  return <ListItem icon={s360EventIcon(e.kind)} title={e.title} subtitle={e.detail || undefined} meta={new Date(e.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} last={last} />
}
function Timeline({ v, studentId }: { v: Student360, studentId: string }) {
  // The first page travels with the picture; one more page is fetched on request (the web pages further).
  const [page, setPage] = useState(1), more = useStudent360Timeline(studentId, page, v.timeline.pageSize)
  const events = [...v.timeline.items, ...(more.data?.items ?? [])], last = more.data ?? v.timeline
  return <>
    <AppText variant="caption" tone="muted">{v.timeline.total} event{v.timeline.total === 1 ? '' : 's'} from the register, homework, exams, fees and documents, newest first.</AppText>
    {events.length === 0 ? <EmptyState icon="time-outline" title="Nothing recorded yet" message="Events appear here as the school records them." /> : s360EventsByDay(events).map(d => <Group key={d.day} title={dayParts(d.day)?.label ?? d.day}>{d.events.map((e, i, all) => <EventRow key={i} e={e} last={i === all.length - 1} />)}</Group>)}
    {last.more && page === 1 && <Button label="Load earlier events" variant="secondary" loading={page > 1 && more.isPending} onPress={() => setPage(2)} />}
    {last.more && page > 1 && <AppText variant="caption" tone="faint">Earlier events are on the EduOS web portal.</AppText>}
  </>
}
const styles = StyleSheet.create({ flex: { flex: 1 }, identity: { flexDirection: 'row', alignItems: 'center', gap: space.md }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm }, pad: { padding: space.md, gap: space.xs, backgroundColor: color.surface }, find: { gap: space.md }, score: { alignItems: 'flex-end', gap: space.xs } })
