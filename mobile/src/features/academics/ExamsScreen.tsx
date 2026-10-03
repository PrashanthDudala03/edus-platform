import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { experienceFor } from '@/access/experience'
import { normalizeError } from '@/api/errors'
import { Chips, Group, Header, ListItem, Sheet } from '@/components/blocks'
import { ListScreen } from '@/components/ListScreen'
import { AppText, Badge, Button, Notice, TextField } from '@/components/ui'
import { useSession } from '@/services'
import { color, space } from '@/theme/tokens'
import { dayParts } from '@/utils/format'
import { useExamOverview, useExamTimetable, useExamTransition, useMarksheet, usePermission, useSaveMarksheet } from '../data'
import { EXAM_STATUS_LABEL, MARK_STATUSES, changedMarks, examActions, examTime, examTone, examTotals, markGrade, markLabel, markProblem, markTotal, splitExams, toMarkEntry, type ExamOverview, type ExamStatus, type MarkEntry, type SheetRow, type TimetableExam } from '../logic'

// Exams. Families see the timetable (never a draft) and open results from Results. Teachers see the timetable and
// enter marks for their classes, then submit them for approval. Leadership sees where every exam stands and can
// approve, return or publish. Exam setup and schemes stay on the web. Same endpoints as the web.
const when = (e: TimetableExam) => (dayParts(e.date)?.label ?? e.date) + (examTime(e) ? ' · ' + examTime(e) : '') + (e.room ? ' · ' + e.room : '')

export function ExamsScreen() {
  const user = useSession(state => state.user), experience = experienceFor(user), staff = experience === 'teacher' || experience === 'principal'
  const [tab, setTab] = useState('upcoming'), [open, setOpen] = useState<ExamOverview | null>(null)
  const timetable = useExamTimetable(), overview = useExamOverview(staff), mayManage = usePermission('exams.manage') && experience === 'principal'
  const split = splitExams(timetable.data?.items ?? [], timetable.data?.today ?? ''), totals = examTotals(overview.data ?? [])
  const list: (TimetableExam | ExamOverview)[] | undefined = tab === 'marks' ? overview.data : tab === 'upcoming' ? split.upcoming : split.held
  return <><ListScreen source={tab === 'marks' ? overview : timetable} items={list} keyOf={item => item.id}
    top={<><Header overline="Academics" title="Exams" route="/exams" />
      {staff && !!overview.data && <AppText variant="caption" tone="muted">{totals.entered} of {totals.expected} marks entered · {totals.pendingApproval} awaiting approval · {totals.published} published</AppText>}
      <Chips value={tab} onChange={setTab} options={[{ key: 'upcoming', label: 'Upcoming', count: timetable.data ? split.upcoming.length : undefined }, { key: 'held', label: 'Held', count: timetable.data ? split.held.length : undefined }, ...(staff ? [{ key: 'marks', label: experience === 'principal' ? 'Status' : 'Marks entry', count: overview.data?.length }] : [])]} /></>}
    empty={tab === 'marks' ? { icon: 'school-outline', title: 'No exams for your classes', message: 'Exams scheduled for your classes and subjects appear here.' } : tab === 'upcoming' ? { icon: 'school-outline', title: 'No exams scheduled', message: 'Upcoming exams appear here once the school schedules them.' } : { icon: 'school-outline', title: 'No earlier exams', message: 'Exams that have been held are listed here.' }}
    row={(item, index, all) => <ListItem icon="school-outline" title={item.name + ' · ' + item.subjectName} subtitle={[item.className, item.term, 'assigned' in item ? `${item.entered} of ${item.assigned} entered` : ''].filter(Boolean).join(' · ')} meta={when(item)} last={index === all.length - 1}
      onPress={'assigned' in item ? () => setOpen(item) : undefined}
      trailing={staff ? <Badge label={EXAM_STATUS_LABEL[item.status]} tone={examTone(item.status)} /> : item.resultsVisible ? <Badge label="Results out" tone="success" /> : undefined} />} />
    {open && <MarksSheet exam={open} mayManage={mayManage} onClose={() => setOpen(null)} />}</>
}

/**
 * The marksheet on a phone: one card per student with Present / Absent / Exempt, a field per component (or the
 * grade), the running total, remarks; save keeps a draft, submit sends the sheet for approval. Read-only once submitted.
 * Leadership sees the same sheet and the approve, return and publish actions.
 */
function MarksSheet({ exam, mayManage, onClose }: { exam: ExamOverview, mayManage: boolean, onClose: () => void }) {
  const sheet = useMarksheet(exam.id), save = useSaveMarksheet(), move = useExamTransition(), teacher = experienceFor(useSession(state => state.user)) === 'teacher'
  const [drafts, setDrafts] = useState<Record<string, MarkEntry>>({}), [notice, setNotice] = useState<{ tone: 'info' | 'danger', text: string } | null>(null), [failed, setFailed] = useState<Record<string, string>>({}), [asking, setAsking] = useState<{ to: ExamStatus, label: string } | null>(null), [reason, setReason] = useState('')
  const data = sheet.data, scheme = data?.scheme, live = data?.exam ?? exam
  const entry = (row: SheetRow) => drafts[row.studentId] ?? toMarkEntry(row, scheme!)
  const set = (row: SheetRow, patch: Partial<MarkEntry>) => setDrafts(d => ({ ...d, [row.studentId]: { ...entry(row), ...patch } }))
  const pending = data ? changedMarks(data.students, drafts, data.scheme) : [], problems = data ? data.students.filter(r => markProblem(entry(r), data.scheme)) : []
  const send = (submit: boolean) => save.mutate({ examId: exam.id, entries: pending, submit }, {
    onSuccess: r => { const map: Record<string, string> = {}; for (const f of r.errors) map[f.studentId] = f.message; setFailed(map); if (!r.errors.length) setDrafts({})
      setNotice(r.errors.length ? { tone: 'danger', text: `${r.saved} saved; ${r.errors.length} row${r.errors.length === 1 ? '' : 's'} need attention.` } : { tone: 'info', text: submit ? 'Marks submitted for approval.' : `${r.saved} mark${r.saved === 1 ? '' : 's'} saved.` }) },
    onError: error => setNotice({ tone: 'danger', text: normalizeError(error).message }) })
  const transition = (to: ExamStatus, label: string, why = '') => move.mutate({ examId: exam.id, to, reason: why, version: live.version }, { onSuccess: () => { setAsking(null); setReason(''); setNotice({ tone: 'info', text: to === 'Published' ? 'Results published.' : label + ': done.' }) }, onError: error => setNotice({ tone: 'danger', text: normalizeError(error).message }) })
  const actions = examActions(live.status, { leadership: mayManage, teacher, entered: data?.entered ?? exam.entered })
  const busy = save.isPending || move.isPending
  return <Sheet visible title={exam.name + ' · ' + exam.subjectName} onClose={() => !busy && onClose()}
    footer={data ? <>{data.canEdit && <Button label={save.isPending ? 'Saving…' : 'Save marks'} variant="secondary" icon="checkmark" disabled={busy || !pending.length || problems.length > 0} onPress={() => send(false)} />}
      {data.canEdit && teacher && (data.canSubmit || pending.length > 0) ? <Button label="Save and submit" icon="send" loading={save.isPending} disabled={busy || problems.length > 0 || (!pending.length && !data.canSubmit)} onPress={() => send(true)} /> : null}
      {mayManage && actions.map(a => <Button key={a.to} label={a.label} variant={a.reason ? 'secondary' : 'primary'} loading={move.isPending} disabled={busy} onPress={() => a.reason ? setAsking({ to: a.to, label: a.label }) : transition(a.to, a.label)} />)}</> : undefined}>
    <View style={styles.row}><Badge label={EXAM_STATUS_LABEL[live.status]} tone={examTone(live.status)} /><AppText variant="caption" tone="muted" style={styles.flex}>{[exam.className, when(live), scheme ? (scheme.gradeOnly ? 'grades ' + scheme.grades.map(g => g.label).join(', ') : 'out of ' + scheme.max + (scheme.passMarks !== null ? ', pass ' + scheme.passMarks : '')) : ''].filter(Boolean).join(' · ')}</AppText></View>
    {!!live.returnReason && live.status === 'MarksEntry' && <Notice tone="warning" message={'Returned for correction: ' + live.returnReason} />}
    {!!notice && <Notice tone={notice.tone} message={notice.text} />}
    {asking && <Group title={asking.label}><View style={styles.pad}><TextField label="Reason" value={reason} onChangeText={setReason} multiline maxLength={500} placeholder="What the teacher should look at" style={{ minHeight: 70, textAlignVertical: 'top' }} />
      <View style={styles.row}><Button label="Cancel" variant="secondary" onPress={() => setAsking(null)} /><Button label={asking.label} disabled={!reason.trim() || busy} onPress={() => transition(asking.to, asking.label, reason.trim())} /></View></View></Group>}
    {sheet.isPending ? <AppText tone="muted">Loading students…</AppText> : sheet.isError ? <Notice tone="danger" message={normalizeError(sheet.error).message} /> : !data || !scheme ? null : data.students.length === 0 ? <AppText tone="muted">No students are allocated to this class.</AppText>
      : <>{data.students.map(row => { const v = entry(row), total = markTotal(v, scheme), problem = failed[row.studentId] || markProblem(v, scheme), present = v.status === 'Present'
        return <Group key={row.studentId} title={row.name + (row.code ? ' · ' + row.code : '')}><View style={styles.pad}>
          {data.canEdit ? <Chips value={v.status} onChange={value => set(row, { status: value as MarkEntry['status'] })} options={MARK_STATUSES.map(st => ({ key: st, label: st }))} /> : <AppText variant="caption" tone="muted">{v.status}</AppText>}
          {present && (scheme.gradeOnly
            ? (data.canEdit ? <TextField label={'Grade (' + scheme.grades.map(g => g.label).join(', ') + ')'} value={v.grade} onChangeText={value => set(row, { grade: value })} maxLength={10} autoCapitalize="characters" /> : <AppText>{markLabel(row.mark, scheme) || '—'}</AppText>)
            : <View style={styles.fields}>{scheme.components.map(c => data.canEdit ? <TextField key={c.name} label={(scheme.type === 'Marks' ? 'Marks' : c.name) + ' / ' + c.max} value={v.components[c.name] ?? ''} onChangeText={value => set(row, { components: { ...v.components, [c.name]: value } })} keyboardType="decimal-pad" style={styles.field} /> : <AppText key={c.name} variant="caption" tone="muted">{c.name}: {v.components[c.name] || '—'} / {c.max}</AppText>)}</View>)}
          {present && !scheme.gradeOnly && total !== null && <AppText variant="bodyStrong">{total} / {scheme.max}{scheme.grades.length ? ' · ' + markGrade(scheme, scheme.max ? total / scheme.max * 100 : 0) : ''}</AppText>}
          {!present && <AppText variant="caption" tone="muted">{v.status === 'Absent' ? 'Absent: scores nothing' : 'Exempt: left out of totals'}</AppText>}
          {data.canEdit ? <TextField label="Remarks" value={v.remarks} onChangeText={value => set(row, { remarks: value })} maxLength={500} /> : !!v.remarks && <AppText variant="caption" tone="muted">{v.remarks}</AppText>}
          {!!problem && <AppText variant="caption" tone="danger">{problem}</AppText>}
        </View></Group> })}
        <AppText variant="caption" tone="muted">{data.entered} of {data.students.length} entered{pending.length ? ` · ${pending.length} unsaved` : ''}{problems.length ? ` · ${problems.length} to fix` : ''}</AppText></>}
  </Sheet>
}
const styles = StyleSheet.create({ flex: { flex: 1 }, row: { flexDirection: 'row', alignItems: 'center', gap: space.sm }, pad: { padding: space.md, gap: space.sm, backgroundColor: color.surface }, fields: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }, field: { minWidth: 120, flexGrow: 1 } })
