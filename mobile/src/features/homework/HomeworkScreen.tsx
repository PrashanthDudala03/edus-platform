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
import { useChildren, useHandIn, useHomeworkBoard, useHomeworkOverview, useHomeworkReview, usePermission, useReviewHomework, useVerifyHomework } from '../data'
import { GROUP_LABEL, HOMEWORK_GROUPS, MODE_LABEL, OUTCOMES, groupTone, handInLabel, marksLabel, mayHandIn, overviewTotals, studentSubmits, tracked, type BoardItem, type HomeworkGroup, type OverviewItem, type ReviewRow } from '../logic'

// Homework & assignments. Families see a board of each assignment's state for one student and hand work in (the
// server decides whether it is late and keeps earlier work when it is handed in again). Teachers see every
// assignment with how the class is doing and review students one after another. Same endpoints as the web.
const due = (item: { dueDate: string, dueTime: string }) => 'Due ' + (dayParts(item.dueDate)?.label ?? item.dueDate) + (item.dueTime ? ' ' + item.dueTime : '')

export function HomeworkScreen() {
  const user = useSession(state => state.user), experience = experienceFor(user)
  return experience === 'parent' || experience === 'student' ? <FamilyBoard student={experience === 'student'} /> : <StaffBoard />
}

function FamilyBoard({ student }: { student: boolean }) {
  const children = useChildren(), [chosen, setChosen] = useState(''), child = children.data?.find(c => c.studentId === chosen) ?? children.data?.[0]
  const board = useHomeworkBoard(child?.studentId), maySubmit = usePermission('submissions.manage') && student, handIn = useHandIn()
  const [tab, setTab] = useState<HomeworkGroup | 'all'>('all'), [open, setOpen] = useState<BoardItem | null>(null), [response, setResponse] = useState(''), [notice, setNotice] = useState<{ tone: 'info' | 'danger', text: string } | null>(null)
  const items = board.data, counts = HOMEWORK_GROUPS.map(g => ({ key: g, label: GROUP_LABEL[g], count: items?.filter(i => i.group === g).length ?? 0 })).filter(g => g.count > 0)
  const shown = items?.filter(i => tab === 'all' || i.group === tab), current = open ? items?.find(i => i.id === open.id) ?? open : null
  const close = () => { setOpen(null); setResponse(''); setNotice(null) }
  const send = () => { if (!current || !child) return; setNotice(null)
    handIn.mutate({ item: current, studentId: child.studentId, response: response.trim() }, { onSuccess: () => { setResponse(''); setNotice({ tone: 'info', text: current.submissionMode === 'Done' ? 'Marked as done.' : current.submission ? 'Handed in again. Your earlier work is kept.' : current.submissionMode === 'File' ? 'Handed in. Upload your files on the EduOS web portal.' : 'Handed in.' }) }, onError: error => setNotice({ tone: 'danger', text: normalizeError(error).message }) }) }
  const mode = current?.submissionMode ?? 'Text', ready = !current ? false : mode === 'Done' ? !current.submission : response.trim().length > 0 && response.trim() !== current.submission?.response || (mode === 'File' && !current.submission)
  return <><ListScreen source={board} items={child ? shown : []} keyOf={item => item.id}
    top={<><Header overline="Learning" title="Homework" route="/homework" />
      {!student && (children.data?.length ?? 0) > 1 && <Chips value={child?.studentId ?? ''} onChange={setChosen} options={children.data!.map(c => ({ key: c.studentId, label: c.name.split(' ')[0] }))} />}
      {counts.length > 1 && <Chips value={tab} onChange={value => setTab(value as HomeworkGroup | 'all')} options={[{ key: 'all', label: 'All', count: items?.length }, ...counts]} />}</>}
    empty={!child && children.data ? { icon: 'people-outline', title: student ? 'Your student record is not linked yet' : 'No children linked yet', message: 'Ask the school office to link this account to the student record.' } : { icon: 'book-outline', title: 'No homework yet', message: 'Assignments appear here once a teacher publishes them.' }}
    row={(item, index, all) => <ListItem icon="book-outline" title={item.title} subtitle={[item.subjectName, item.teacher].filter(Boolean).join(' · ')} meta={due(item) + (marksLabel(item.submission, item.maxMarks) ? ' · ' + marksLabel(item.submission, item.maxMarks) : '')} last={index === all.length - 1} onPress={() => setOpen(item)}
      trailing={<Badge label={GROUP_LABEL[item.group]} tone={groupTone(item.group)} />} />} />
    <Sheet visible={!!current} title={current?.title ?? ''} onClose={close}
      footer={current && child && maySubmit && mayHandIn(current) && ready ? <Button label={handInLabel(current)} icon={mode === 'Done' ? 'checkmark' : 'send'} loading={handIn.isPending} onPress={send} /> : undefined}>
      {current && <>
        <View style={styles.row}><Badge label={GROUP_LABEL[current.group]} tone={groupTone(current.group)} /><AppText variant="caption" tone="muted" style={styles.flex}>{[current.subjectName, current.teacher, due(current), current.maxMarks ? 'out of ' + current.maxMarks : '', MODE_LABEL[mode]].filter(Boolean).join(' · ')}</AppText></View>
        <AppText>{current.instructions}</AppText>
        {current.attachments > 0 && <AppText variant="caption" tone="muted">{current.attachments} resource{current.attachments === 1 ? '' : 's'} attached · open them on the EduOS web portal.</AppText>}
        {current.submission && (current.submission.grade || current.submission.feedback) && <Notice message={`Teacher's review${marksLabel(current.submission, current.maxMarks) ? ': ' + marksLabel(current.submission, current.maxMarks) : ''}${current.submission.feedback ? '\n' + current.submission.feedback : ''}`} />}
        {!!current.submission?.outcome && <AppText variant="caption" tone="muted">Your teacher checked this as {current.submission.outcome.toLowerCase()}.</AppText>}
        {mode === 'Physical' && !current.submission && <Notice message="Show this work to your teacher in class. Nothing is handed in online." />}
        {current.submission?.submittedAt && <Group title={(mode === 'Done' ? 'Marked as done' : 'Handed in') + (current.submission.late ? ' late' : '')}><View style={styles.pad}><AppText variant="caption" tone="muted">{dayParts(current.submission.submittedAt.slice(0, 10))?.label ?? ''}{current.submission.resubmissions ? ` · handed in ${current.submission.resubmissions + 1} times` : ''}</AppText>{!!current.submission.response && <AppText>{current.submission.response}</AppText>}</View></Group>}
        {!!notice && <Notice tone={notice.tone} message={notice.text} />}
        {maySubmit && mayHandIn(current) && (child ? <>{current.group === 'missing' && !current.submission && <Notice tone="warning" message={`The due time has passed; this will be recorded as ${mode === 'Done' ? 'done' : 'handed in'} late.`} />}
          {mode === 'File' && <Notice message="Files are uploaded on the EduOS web portal. You can hand in here and add notes for your teacher." />}
          {mode !== 'Done' && <TextField label={mode === 'File' ? 'Notes for your teacher (optional)' : current.submission ? 'Hand in again' : 'Your response'} value={response} onChangeText={setResponse} multiline maxLength={4000} placeholder={mode === 'File' ? 'Anything your teacher should know about the files' : 'Write your answer or notes for your teacher'} style={{ minHeight: mode === 'File' ? 70 : 110, textAlignVertical: 'top' }} />}</>
          : <Notice tone="warning" message="Your account is not linked to a student record yet, so work cannot be handed in. Ask the school office." />)}
        {maySubmit && !mayHandIn(current) && studentSubmits(mode) && <Notice message={current.status === 'Closed' ? 'This assignment is closed.' : current.submission?.status === 'Reviewed' ? 'This work has been reviewed and can no longer be changed.' : current.submission?.outcome === 'Excused' ? 'You have been excused from this assignment.' : 'This assignment is not open for handing in.'} />}
      </>}
    </Sheet></>
}

function StaffBoard() {
  const work = useHomeworkOverview(), mayReview = usePermission('homework.manage'), [tab, setTab] = useState('attention'), [open, setOpen] = useState<OverviewItem | null>(null)
  const items = work.data, totals = overviewTotals(items ?? [])
  const shown = items?.filter(i => tab === 'all' || (tab === 'attention' ? i.pending > 0 || i.missing > 0 : i.status === tab))
  return <><ListScreen source={work} items={shown} keyOf={item => item.id}
    top={<><Header overline="Learning" title="Assignments" route="/homework" />
      {!!items && <AppText variant="caption" tone="muted">{totals.published} published · {totals.toReview} to review · {totals.missing} missing · {totals.late} handed in late</AppText>}
      <Chips value={tab} onChange={setTab} options={[{ key: 'attention', label: 'Needs attention', count: items?.filter(i => i.pending > 0 || i.missing > 0).length }, { key: 'all', label: 'All', count: items?.length }, { key: 'Published', label: 'Published' }, { key: 'Draft', label: 'Drafts' }, { key: 'Closed', label: 'Closed' }]} /></>}
    empty={{ icon: 'book-outline', title: tab === 'attention' ? 'Nothing to review' : 'No assignments', message: tab === 'attention' ? 'Work that is handed in or overdue appears here.' : 'Assignments are set on the EduOS web portal.' }}
    row={(item, index, all) => <ListItem icon="book-outline" title={item.title} subtitle={[item.className, item.subjectName].filter(Boolean).join(' · ')} meta={`${due(item)} · ${item.submitted} of ${item.assigned} handed in${item.missing ? ` · ${item.missing} missing` : ''}${item.pending ? ` · ${item.pending} to review` : ''}`} last={index === all.length - 1} onPress={() => setOpen(item)}
      trailing={<Badge label={item.status} tone={item.status === 'Published' ? 'success' : item.status === 'Draft' ? 'warning' : 'neutral'} />} />} />
    {open && <ReviewSheet item={open} mayReview={mayReview} onClose={() => setOpen(null)} />}</>
}

/**
 * One assignment, student by student. Notebook and in-class work is checked off per student (Completed, Late,
 * Missing, Excused) with one tap and no upload; written and uploaded work is also given marks and feedback. Same calls as the web.
 */
function ReviewSheet({ item, mayReview, onClose }: { item: OverviewItem, mayReview: boolean, onClose: () => void }) {
  const rows = useHomeworkReview(item.id), review = useReviewHomework(), verify = useVerifyHomework(), online = item.submissionMode === 'Text' || item.submissionMode === 'File'
  const [current, setCurrent] = useState<ReviewRow | null>(null), [grade, setGrade] = useState(''), [feedback, setFeedback] = useState(''), [notice, setNotice] = useState<{ tone: 'info' | 'danger', text: string } | null>(null)
  const pick = (row: ReviewRow) => { setCurrent(row); setGrade(row.submission?.grade ?? ''); setFeedback(row.submission?.feedback ?? ''); setNotice(null) }
  const students = rows.data ?? [], index = current ? students.findIndex(r => r.studentId === current.studentId) : -1, live = current ? students.find(r => r.studentId === current.studentId) ?? current : null
  const save = () => { if (!current) return
    review.mutate({ homeworkId: item.id, studentId: current.studentId, grade: grade.trim(), feedback: feedback.trim(), version: live?.submission?.version ?? 0 }, { onSuccess: () => { const next = students.slice(index + 1).find(r => r.submission && r.submission.status !== 'Reviewed'); if (next) pick(next); else { setCurrent(null); setNotice({ tone: 'info', text: 'Review saved.' }) } }, onError: error => setNotice({ tone: 'danger', text: normalizeError(error).message }) }) }
  const check = (row: ReviewRow, outcome: string) => verify.mutate({ homeworkId: item.id, studentId: row.studentId, outcome: row.submission?.outcome === outcome ? '' : outcome, version: row.submission?.version }, { onError: error => setNotice({ tone: 'danger', text: normalizeError(error).message }) })
  const canMark = mayReview && (online || !!live?.submission)
  return <Sheet visible title={current ? current.name : item.title} onClose={current ? () => setCurrent(null) : onClose}
    footer={current && canMark ? <><Button label="Back" variant="secondary" onPress={() => setCurrent(null)} /><Button label={index >= 0 && students.slice(index + 1).some(r => r.submission && r.submission.status !== 'Reviewed') ? 'Save and next' : 'Save review'} icon="checkmark" loading={review.isPending} disabled={!grade.trim() && !feedback.trim() && !live?.submission?.grade && !live?.submission?.feedback} onPress={save} /></> : undefined}>
    {!current ? <>
      <AppText variant="caption" tone="muted">{[item.className, item.subjectName, due(item), item.maxMarks ? 'out of ' + item.maxMarks : '', MODE_LABEL[item.submissionMode]].filter(Boolean).join(' · ')}</AppText>
      {!!notice && <Notice tone={notice.tone} message={notice.text} />}
      {rows.isPending ? <AppText tone="muted">Loading students…</AppText> : rows.isError ? <Notice tone="danger" message={normalizeError(rows.error).message} /> : students.length === 0 ? <AppText tone="muted">No students are allocated to this class.</AppText>
        : <Group>{students.map((r, i) => <ListItem key={r.studentId} title={r.name} subtitle={[r.code, marksLabel(r.submission, item.maxMarks)].filter(Boolean).join(' · ')} trailing={<Badge label={GROUP_LABEL[r.group]} tone={groupTone(r.group)} />} onPress={r.submission || (mayReview && tracked(item.submissionMode)) ? () => pick(r) : undefined} last={i === students.length - 1} />)}</Group>}
    </> : <>
      <View style={styles.row}><Badge label={GROUP_LABEL[live!.group]} tone={groupTone(live!.group)} />{!!live?.submission?.submittedAt && <AppText variant="caption" tone="muted" style={styles.flex}>{item.submissionMode === 'Done' ? 'Marked as done' : 'Handed in'} {dayParts(live.submission.submittedAt.slice(0, 10))?.label ?? ''}{live.submission.late ? ' · after the due time' : ''}{live.submission.resubmissions ? ` · ${live.submission.resubmissions + 1} times` : ''}</AppText>}</View>
      {mayReview && tracked(item.submissionMode) && <Group title="Check"><View style={styles.pad}><Chips value={live?.submission?.outcome ?? ''} onChange={value => check(live!, value)} options={OUTCOMES.map(o => ({ key: o, label: o }))} /><AppText variant="caption" tone="muted">{verify.isPending ? 'Saving…' : 'Tap again to clear. No upload is needed.'}</AppText></View></Group>}
      {!!live?.submission?.response && <AppText>{live.submission.response}</AppText>}
      {!!live?.submission?.attachments && <AppText variant="caption" tone="muted">{live.submission.attachments} file{live.submission.attachments === 1 ? '' : 's'} attached · open them on the EduOS web portal.</AppText>}
      {!!notice && <Notice tone={notice.tone} message={notice.text} />}
      {canMark && <><TextField label={item.maxMarks ? `Marks (out of ${item.maxMarks})` : 'Marks or grade'} value={grade} onChangeText={setGrade} maxLength={50} keyboardType={item.maxMarks ? 'decimal-pad' : 'default'} />
        <TextField label="Feedback" value={feedback} onChangeText={setFeedback} multiline maxLength={4000} style={{ minHeight: 90, textAlignVertical: 'top' }} /></>}
    </>}
  </Sheet>
}
const styles = StyleSheet.create({ flex: { flex: 1 }, row: { flexDirection: 'row', alignItems: 'center', gap: space.sm }, pad: { padding: space.md, gap: space.xs, backgroundColor: color.surface } })
