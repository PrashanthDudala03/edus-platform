import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Check, Plus, Send } from 'lucide-react'
import client, { errorMessage } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { Dialog, Empty, ErrorBox, Loading, PageHeader, today } from '../../components/UI'
import { data, type Options } from './helpers'
import { Attachments } from './SuitePage'
import { isLeadership } from '../../roles'
import { GROUPS, GROUP_LABEL, MODES, MODE_HELP, MODE_LABEL, OUTCOMES, dueLabel, emptyDraft, groupTone, handInLabel, marksLabel, nextStatuses, overviewTotals, studentSubmits, toDraft, tracked, type Assignment, type BoardItem, type Draft, type Mode, type Outcome, type OverviewItem, type ReviewRow } from './homework'

// Homework & assignments. Staff see every assignment they manage with how the class is doing, create and publish work,
// and review submissions student by student. Families see a board of each assignment's state for one student and
// hand work in. Everything comes from the homework endpoints, which apply the person's scope.
const useOptions = () => useQuery<Options>({ queryKey: ['suite', 'options'], queryFn: () => data('/options') })
export const useBoard = (studentId: string | undefined) => useQuery<{ items: BoardItem[], counts: Record<string, number> }>({ queryKey: ['suite', 'homework-board', studentId], enabled: !!studentId, queryFn: () => data('/homework/board', { studentId }) })
export const useOverview = (enabled = true) => useQuery<{ items: OverviewItem[] }>({ queryKey: ['suite', 'homework-overview'], enabled, queryFn: () => data('/homework/overview') })

export default function HomeworkPage() {
  const user = useAuthStore(s => s.user), role = user?.roles[0] ?? '', staff = isLeadership(role) || role === 'Teacher'
  return staff ? <StaffHomework /> : <FamilyHomework />
}

function StaffHomework() {
  const cache = useQueryClient(), can = useAuthStore(s => s.user?.permissions.includes('homework.manage') ?? false), leader = isLeadership(useAuthStore(s => s.user?.roles[0]))
  const overview = useOverview(), options = useOptions()
  const [filter, setFilter] = useState<'all' | 'Published' | 'Draft' | 'Closed' | 'attention'>('all'), [editing, setEditing] = useState<{ id?: string, draft: Draft, submissions: number } | null>(null), [review, setReview] = useState<Assignment | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const items = overview.data?.items ?? [], totals = overviewTotals(items)
  const shown = items.filter(i => filter === 'all' || (filter === 'attention' ? i.pending > 0 || i.missing > 0 : i.status === filter))
  const refresh = () => Promise.all([cache.invalidateQueries({ queryKey: ['suite', 'homework-overview'] }), cache.invalidateQueries({ queryKey: ['suite', 'homework', 'dashboard'] }), cache.invalidateQueries({ queryKey: ['suite', 'homework-board'] })])
  async function save(e: FormEvent<HTMLFormElement>, publish = false) {
    e.preventDefault(); if (!editing) return; setBusy(true); setError('')
    const body = { ...editing.draft, status: publish ? 'Published' : editing.draft.status, maxMarks: editing.draft.maxMarks || '', dueTime: editing.draft.dueTime || '' }
    try {
      const r = editing.id ? await client.put('/suite/records/homework/' + editing.id, { ...body, version: items.find(i => i.id === editing.id)?.version }) : await client.post('/suite/records/homework', body)
      setMessage(publish ? 'Assignment published. Students and families have been told.' : editing.id ? 'Assignment saved.' : 'Draft saved. Publish it when it is ready.')
      if (!editing.id) setEditing({ id: r.data.data.id, draft: { ...editing.draft, status: body.status as Draft['status'] }, submissions: 0 }); else setEditing(null)
      await refresh()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return <><PageHeader eyebrow="LEARNING" title="Homework & assignments" description={leader ? 'Every assignment in the school, with who has handed in, who is late and what is still to review.' : 'Set work for your classes, publish it, and review what students hand in.'}>
    {can && <button className="button primary" onClick={() => { setMessage(''); setEditing({ draft: emptyDraft(today()), submissions: 0 }) }}><Plus size={16} />New assignment</button>}</PageHeader>
    {message && <div className="success-box" role="status">{message}</div>}
    {overview.isError ? <ErrorBox message={errorMessage(overview.error)} /> : <>
      <div className="stats-grid"><div className="stat-card"><strong>{totals.published}</strong><h2>Published</h2><p>{totals.drafts} draft{totals.drafts === 1 ? '' : 's'}</p></div><div className="stat-card"><strong>{totals.toReview}</strong><h2>To review</h2><p>Written or uploaded work, not yet marked</p></div><div className="stat-card"><strong>{totals.missing}</strong><h2>Missing</h2><p>Overdue or checked as missing</p></div><div className="stat-card"><strong>{totals.late}</strong><h2>Completed late</h2><p>After the due time</p></div></div>
      <div className="module-tabs">{([['all', 'All'], ['attention', 'Needs attention'], ['Published', 'Published'], ['Draft', 'Drafts'], ['Closed', 'Closed']] as const).map(([key, label]) => <a key={key} href="#" className={filter === key ? 'active' : ''} onClick={e => { e.preventDefault(); setFilter(key) }}>{label}</a>)}</div>
      <section className="panel homework-panel">{overview.isPending ? <Loading /> : !shown.length ? <Empty title={items.length ? 'Nothing here' : 'No assignments yet'} description={items.length ? 'Try another filter.' : can ? 'Create an assignment for one of your classes.' : 'Assignments for this school appear here.'} /> : <div className="table-scroll"><table>
        <thead><tr><th>Assignment</th><th>Class · subject</th><th>Due</th><th>Status</th><th>Handed in</th><th>To review</th><th>Missing</th><th>Actions</th></tr></thead>
        <tbody>{shown.map(i => <tr key={i.id}><td><strong>{i.title}</strong><small className="muted"> · {MODE_LABEL[i.submissionMode]}{i.attachments ? ` · ${i.attachments} file${i.attachments === 1 ? '' : 's'}` : ''}</small></td><td>{i.className} · {i.subjectName}</td><td>{dueLabel(i)}</td><td><span className={'status-tag ' + (i.status === 'Published' ? 'active' : i.status === 'Draft' ? 'important' : '')}>{i.status}</span></td>
          <td>{i.submitted} of {i.assigned}{i.late ? <small className="muted"> · {i.late} late</small> : null}</td><td>{i.pending || '—'}</td><td>{i.missing ? <span className="status-tag important">{i.missing}</span> : '—'}</td>
          <td><div className="row-actions"><button className="button small secondary" onClick={() => setReview(i)}>{i.submissionMode === 'Text' || i.submissionMode === 'File' ? 'Review' : 'Check'}</button>{can && <button className="button small secondary" onClick={() => { setMessage(''); setEditing({ id: i.id, draft: toDraft(i), submissions: i.submitted }) }}>Edit</button>}</div></td></tr>)}</tbody></table></div>}</section></>}
    {editing && <Dialog title={editing.id ? 'Edit assignment' : 'New assignment'} onClose={() => !busy && setEditing(null)}><form onSubmit={save}>{error && <ErrorBox message={error} />}
      <div className="form-grid">
        <label className="full-width">Title<input required maxLength={255} value={editing.draft.title} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, title: e.target.value } })} /></label>
        <label>Class<select required value={editing.draft.classId} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, classId: e.target.value } })}><option value="">Select class</option>{options.data?.classes?.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <label>Subject<select required value={editing.draft.subjectId} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, subjectId: e.target.value } })}><option value="">Select subject</option>{options.data?.subjects?.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <label>Due date<input type="date" required value={editing.draft.dueDate} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, dueDate: e.target.value } })} /></label>
        <label>Due time (optional)<input type="time" value={editing.draft.dueTime} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, dueTime: e.target.value } })} /></label>
        <label>Maximum marks (optional)<input type="number" min={1} max={1000} step="any" value={editing.draft.maxMarks} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, maxMarks: e.target.value } })} /></label>
        <label>Submission mode<select value={editing.draft.submissionMode} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, submissionMode: e.target.value as Mode } })}>{MODES.map(m => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</select><small className="muted">{MODE_HELP[editing.draft.submissionMode]}</small></label>
        <label>Status<select value={editing.draft.status} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, status: e.target.value as Draft['status'] } })}>{nextStatuses(editing.id ? editing.draft.status : '', editing.submissions).map(s => <option key={s}>{s}</option>)}</select></label>
        <label className="full-width">Instructions<textarea required rows={5} maxLength={4000} value={editing.draft.instructions} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, instructions: e.target.value } })} /></label>
      </div>
      {editing.id ? <Attachments recordId={editing.id} canUpload={can} /> : <p className="muted">Save the draft first to attach worksheets or resources.</p>}
      <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={() => setEditing(null)}>Close</button><button className="button secondary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>{editing.draft.status !== 'Published' && <button type="button" className="button primary" disabled={busy} onClick={e => save(e as unknown as FormEvent<HTMLFormElement>, true)}><Send size={15} />Save and publish</button>}</div></form></Dialog>}
    {review && <ReviewDialog assignment={review} canReview={can} onClose={() => setReview(null)} onChanged={refresh} />}</>
}

/**
 * One assignment, student by student. For notebook and in-class work the teacher checks each student off as
 * Completed, Late, Missing or Excused in one click; written and uploaded work is opened and given marks and feedback.
 */
function ReviewDialog({ assignment, canReview, onClose, onChanged }: { assignment: Assignment, canReview: boolean, onClose: () => void, onChanged: () => Promise<unknown> }) {
  const cache = useQueryClient(), online = assignment.submissionMode === 'Text' || assignment.submissionMode === 'File'
  const rows = useQuery<{ assignment: Assignment, students: ReviewRow[] }>({ queryKey: ['suite', 'homework-review', assignment.id], queryFn: () => data('/homework/' + assignment.id + '/submissions') })
  const [open, setOpen] = useState(''), [grade, setGrade] = useState(''), [feedback, setFeedback] = useState(''), [busy, setBusy] = useState(''), [error, setError] = useState('')
  const students = rows.data?.students ?? [], current = students.find(s => s.studentId === open), index = students.findIndex(s => s.studentId === open)
  const pick = (row: ReviewRow) => { setOpen(row.studentId); setGrade(row.submission?.grade ?? ''); setFeedback(row.submission?.feedback ?? ''); setError('') }
  const refresh = async () => { await cache.invalidateQueries({ queryKey: ['suite', 'homework-review', assignment.id] }); await onChanged() }
  async function send() {
    if (!current) return; setBusy(current.studentId); setError('')
    try { await client.put(`/suite/homework/${assignment.id}/review/${current.studentId}`, { grade, feedback, version: current.submission?.version }); await refresh(); const next = students.slice(index + 1).find(r => r.submission && r.submission.status !== 'Reviewed'); if (next) pick(next); else setOpen('') }
    catch (e) { setError(errorMessage(e)) } finally { setBusy('') }
  }
  async function verify(row: ReviewRow, outcome: Outcome) {
    setBusy(row.studentId); setError('')
    try { await client.put(`/suite/homework/${assignment.id}/verify/${row.studentId}`, { outcome: row.submission?.outcome === outcome ? '' : outcome, version: row.submission?.version }); await refresh() }
    catch (e) { setError(errorMessage(e)) } finally { setBusy('') }
  }
  return <Dialog title={(online ? 'Review · ' : 'Check · ') + assignment.title} onClose={onClose}>
    <p className="muted">{assignment.className} · {assignment.subjectName} · due {dueLabel(assignment)}{assignment.maxMarks ? ' · out of ' + assignment.maxMarks : ''} · {MODE_LABEL[assignment.submissionMode]}</p>
    {error && !current && <ErrorBox message={error} />}
    {rows.isPending ? <Loading /> : rows.isError ? <ErrorBox message={errorMessage(rows.error)} /> : !students.length ? <Empty title="No students in this class" description="Allocate students to the class to assign work." /> : <>
      <div className="table-scroll review-table"><table><thead><tr><th>Student</th><th>State</th><th>Marks</th><th>Actions</th></tr></thead><tbody>{students.map(r => <tr key={r.studentId} className={r.studentId === open ? 'active' : ''}><td>{r.name}<small className="muted"> {r.code}</small></td><td><span className={'status-tag ' + groupTone(r.group)}>{GROUP_LABEL[r.group]}</span></td><td>{marksLabel(r.submission, assignment.maxMarks) || (r.submission?.feedback ? 'Feedback' : '—')}</td>
        <td><div className="row-actions">
          {canReview && tracked(assignment.submissionMode) && <span className="verify-group" role="group" aria-label={'Check ' + r.name}>{OUTCOMES.map(o => <button key={o} className={'button small ' + (r.submission?.outcome === o ? 'primary' : 'secondary')} aria-pressed={r.submission?.outcome === o} disabled={busy === r.studentId} onClick={() => verify(r, o)}>{o}</button>)}</span>}
          {(r.submission?.response || r.submission?.attachments || r.submission?.status === 'Reviewed' || (!online && r.submission && canReview)) ? <button className="button small secondary" onClick={() => pick(r)}>{r.submission?.status === 'Reviewed' ? 'Edit review' : online ? 'Review' : 'Marks'}</button> : !canReview || !tracked(assignment.submissionMode) ? <span className="muted">{online ? 'Nothing handed in' : '—'}</span> : null}
        </div></td></tr>)}</tbody></table></div>
      {current && <div className="review-box"><h3>{current.name}{current.submission?.late && <span className="status-tag important">{current.submission.submittedAt ? 'Handed in late' : 'Completed late'}</span>}</h3>
        {current.submission?.submittedAt ? <small className="muted">{assignment.submissionMode === 'Done' ? 'Marked as done' : 'Handed in'} {new Date(current.submission.submittedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{current.submission.resubmissions ? ` · handed in ${current.submission.resubmissions + 1} times` : ''}</small> : current.submission?.outcome ? <small className="muted">Checked as {current.submission.outcome.toLowerCase()} by the teacher</small> : null}
        {current.submission?.response && <p className="review-response">{current.submission.response}</p>}
        {current.submission && assignment.submissionMode === 'File' && <Attachments recordId={current.submission.id} canUpload={false} />}
        {canReview && <>{error && <ErrorBox message={error} />}<div className="form-grid"><label>Marks{assignment.maxMarks ? ' (out of ' + assignment.maxMarks + ')' : ''}<input value={grade} maxLength={50} onChange={e => setGrade(e.target.value)} /></label><label className="full-width">Feedback<textarea rows={3} maxLength={4000} value={feedback} onChange={e => setFeedback(e.target.value)} /></label></div>
          <div className="modal-footer"><button type="button" className="button secondary" disabled={!!busy} onClick={() => setOpen('')}>Cancel</button><button type="button" className="button primary" disabled={!!busy || (!grade && !feedback && !current.submission?.grade && !current.submission?.feedback)} onClick={send}><Check size={15} />{busy ? 'Saving…' : students.slice(index + 1).some(r => r.submission && r.submission.status !== 'Reviewed') ? 'Save and next' : 'Save review'}</button></div></>}</div>}</>}
  </Dialog>
}

/** The board for one student: for a parent, each child in turn; for a student, their own. */
function FamilyHomework() {
  const user = useAuthStore(s => s.user), student = user?.roles[0] === 'Student', options = useOptions()
  const children = options.data?.students ?? [], [chosen, setChosen] = useState(''), child = children.find(c => c.id === chosen) ?? children[0]
  return <><PageHeader eyebrow={student ? 'MY LEARNING' : 'PARENT PORTAL'} title="Homework" description={student ? 'What you need to do, what you handed in, and what your teachers said.' : "Your child's assignments: what is due, what was handed in, and the teacher's feedback."}>
    {!student && children.length > 1 && <label className="child-switcher">Child<select aria-label="Choose child" value={child?.id ?? ''} onChange={e => setChosen(e.target.value)}>{children.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}</PageHeader>
    {options.isPending ? <Loading /> : !child ? <section className="panel"><Empty title={student ? 'Your student record is not linked yet' : 'No children linked yet'} description="Ask the school administrator to link this account to the student record." /></section> : <Board key={child.id} studentId={child.id} studentName={child.label} canSubmit={student} />}</>
}

export function Board({ studentId, studentName, canSubmit, compact }: { studentId: string, studentName: string, canSubmit: boolean, compact?: boolean }) {
  const board = useBoard(studentId), [open, setOpen] = useState<BoardItem | null>(null)
  if (board.isPending) return <Loading />
  if (board.isError) return <ErrorBox message={errorMessage(board.error)} />
  const items = Array.isArray(board.data?.items) ? board.data.items : [], counts = board.data?.counts ?? {}, groups = GROUPS.filter(g => items.some(i => i.group === g)).slice(0, compact ? 3 : 8)
  if (!items.length) return <section className="panel"><Empty title="No homework yet" description={`Assignments for ${studentName}'s class appear here once a teacher publishes them.`} /></section>
  return <>{groups.map(g => <section key={g} className="panel homework-panel"><div className="panel-heading"><div><h2>{GROUP_LABEL[g]}</h2><p>{counts[g] ?? items.filter(i => i.group === g).length} assignment{(counts[g] ?? 0) === 1 ? '' : 's'}</p></div>{compact && <Link className="text-link" to="/suite/homework">All homework</Link>}</div>
    <ul className="dash-list homework-list">{items.filter(i => i.group === g).slice(0, compact ? 3 : 100).map(i => <li key={i.id}><span className="stat-icon teal"><BookOpen size={17} /></span><div><strong>{i.title}</strong><small>{i.subjectName}{i.teacher ? ' · ' + i.teacher : ''} · due {dueLabel(i)}{marksLabel(i.submission, i.maxMarks) ? ' · ' + marksLabel(i.submission, i.maxMarks) : ''}</small></div><span className={'status-tag ' + groupTone(i.group)}>{GROUP_LABEL[i.group]}</span><button className="button small secondary" onClick={() => setOpen(i)}>Open</button></li>)}</ul></section>)}
    {open && <AssignmentDialog item={open} studentId={studentId} canSubmit={canSubmit} onClose={() => setOpen(null)} />}</>
}

function AssignmentDialog({ item, studentId, canSubmit, onClose }: { item: BoardItem, studentId: string, canSubmit: boolean, onClose: () => void }) {
  const cache = useQueryClient(), [response, setResponse] = useState(item.submission?.response ?? ''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState('')
  const mode = item.submissionMode, editable = canSubmit && studentSubmits(mode) && item.status === 'Published' && item.submission?.status !== 'Reviewed' && item.submission?.outcome !== 'Excused'
  const changed = mode === 'Done' ? !item.submission : response.trim() !== (item.submission?.response ?? '') && (mode !== 'Text' || !!response.trim())
  async function submit() {
    setBusy(true); setError('')
    try {
      if (item.submission) await client.put('/suite/records/submissions/' + item.submission.id, { homeworkId: item.id, studentId, response, feedback: item.submission.feedback, grade: item.submission.grade, version: item.submission.version })
      else await client.post('/suite/records/submissions', { homeworkId: item.id, studentId, response, feedback: '', grade: '' })
      setDone(mode === 'Done' ? 'Marked as done.' : item.submission ? 'Handed in again. Your earlier work is kept.' : mode === 'File' ? 'Handed in. Add your files below.' : 'Handed in.'); await cache.invalidateQueries({ queryKey: ['suite', 'homework-board'] })
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  return <Dialog title={item.title} onClose={onClose}>
    <p className="muted">{item.subjectName}{item.teacher ? ' · ' + item.teacher : ''} · due {dueLabel(item)}{item.maxMarks ? ' · out of ' + item.maxMarks : ''} · {MODE_LABEL[mode]}</p>
    <span className={'status-tag ' + groupTone(item.group)}>{GROUP_LABEL[item.group]}</span>
    <p className="homework-instructions">{item.instructions}</p>
    {item.attachments > 0 && <Attachments recordId={item.id} canUpload={false} />}
    {item.submission && (item.submission.grade || item.submission.feedback) && <div className="review-box"><h3>Teacher's review</h3>{marksLabel(item.submission, item.maxMarks) && <p><strong>{marksLabel(item.submission, item.maxMarks)}</strong></p>}{item.submission.feedback && <p>{item.submission.feedback}</p>}</div>}
    {item.submission?.outcome && <p className="muted">Your teacher checked this as {item.submission.outcome.toLowerCase()}.</p>}
    {mode === 'Physical' && !item.submission && <p className="muted">Show this work to your teacher in class. Nothing is handed in online.</p>}
    {studentSubmits(mode) && (item.submission || editable) && <div className="review-box"><h3>{mode === 'Done' ? 'Done?' : item.submission ? 'Your work' : 'Hand in'}</h3>{item.submission?.submittedAt && <small className="muted">{mode === 'Done' ? 'Marked as done' : 'Handed in'} {new Date(item.submission.submittedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{item.submission.late ? ' · after the due time' : ''}</small>}
      {done && <div className="success-box" role="status">{done}</div>}{error && <ErrorBox message={error} />}
      {editable ? <>{mode !== 'Done' && <label>{mode === 'File' ? 'Notes for your teacher (optional)' : 'Your response'}<textarea rows={mode === 'File' ? 2 : 5} maxLength={4000} value={response} onChange={e => setResponse(e.target.value)} placeholder={mode === 'File' ? 'Anything your teacher should know about the files' : 'Write your answer or notes for your teacher'} /></label>}
        {item.group === 'missing' && !item.submission && <p className="muted">The due time has passed; this will be recorded as {mode === 'Done' ? 'done' : 'handed in'} late.</p>}
        {changed && <div className="modal-footer"><button type="button" className="button primary" disabled={busy} onClick={submit}>{mode === 'Done' ? <Check size={15} /> : <Send size={15} />}{busy ? 'Sending…' : handInLabel(item)}</button></div>}</> : item.submission?.response && <p className="review-response">{item.submission.response}</p>}
      {item.submission && mode === 'File' && <Attachments recordId={item.submission.id} canUpload={editable} />}</div>}
  </Dialog>
}
