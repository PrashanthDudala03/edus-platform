import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ClipboardList, Plus, Printer, Send } from 'lucide-react'
import client, { errorMessage } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { Dialog, Empty, ErrorBox, Loading, PageHeader, today } from '../../components/UI'
import { data, printSchoolDocument, type Options } from './helpers'
import { isLeadership } from '../../roles'
import { MARK_STATUSES, SCHEME_TYPE_LABEL, STATUSES, STATUS_LABEL, analytics, byDay, changedEntries, completion, componentsLabel, dayLabel, emptyDraft, entryProblem, entryTotal, gradeFor, marksLabel, nextActions, statusTone, timeLabel, toDraft, toEntry, upcoming, type Attention, type Draft, type Entry, type Exam, type ExamStatus, type OverviewExam, type ReportCard, type Sheet, type SheetRow, type Totals } from './exams'

// Exams & report cards. Leadership schedules exams (with an assessment scheme), reviews, approves and publishes;
// teachers enter marks for their own classes quickly and submit them; families see the timetable, published results
// and the report card. Everything comes from the exam endpoints, which apply the person's scope.
const useOptions = () => useQuery<Options>({ queryKey: ['suite', 'options'], queryFn: () => data('/options') })
export const useTimetable = (enabled = true) => useQuery<{ items: Exam[], today: string }>({ queryKey: ['suite', 'exam-timetable'], enabled, queryFn: () => data('/exams/timetable') })
export const useExamOverview = (enabled = true) => useQuery<{ items: OverviewExam[], totals: Totals, attention: Attention[] }>({ queryKey: ['suite', 'exam-overview'], enabled, queryFn: () => data('/exams/overview') })
const useSheet = (examId: string) => useQuery<Sheet>({ queryKey: ['suite', 'marksheet', examId], queryFn: () => data('/exams/' + examId + '/marksheet') })
const useReport = (studentId: string | undefined) => useQuery<ReportCard>({ queryKey: ['suite', 'report-card', studentId], enabled: !!studentId, queryFn: () => data('/report-cards/' + studentId) })
const refreshAll = (cache: ReturnType<typeof useQueryClient>) => Promise.all(['exam-timetable', 'exam-overview', 'marksheet', 'report-card', 'exams', 'marks'].map(k => cache.invalidateQueries({ queryKey: ['suite', k] })))
type Tab = 'timetable' | 'exams' | 'review' | 'analytics' | 'marks' | 'results'

export default function ExamsPage({ kind }: { kind: string }) {
  const user = useAuthStore(s => s.user), role = user?.roles[0] ?? '', leader = isLeadership(role), teacher = role === 'Teacher'
  const tabs: [Tab, string][] = leader ? [['timetable', 'Timetable'], ['exams', 'Exams'], ['review', 'Review & publish'], ['analytics', 'Analytics']] : teacher ? [['timetable', 'Timetable'], ['marks', 'Marks entry']] : [['timetable', 'Timetable'], ['results', 'Results']]
  const [tab, setTab] = useState<Tab>(kind === 'marks' ? (leader ? 'review' : teacher ? 'marks' : 'results') : leader ? 'exams' : 'timetable')
  const [message, setMessage] = useState('')
  return <><PageHeader eyebrow={leader ? 'ACADEMICS' : teacher ? 'TEACHING' : 'PROGRESS'} title={leader ? 'Exams & report cards' : teacher ? 'Exams & marks' : 'Exams & results'} description={leader ? 'Schedule exams, review the marks teachers submit, publish results and read how the school is doing.' : teacher ? 'The timetable for your classes and fast marks entry, submitted to the school for approval.' : 'Upcoming exams, published results and the report card.'}>
    {leader && <Link className="button secondary" to="/suite/assessment-schemes">Assessment schemes</Link>}</PageHeader>
    {message && <div className="success-box" role="status">{message}</div>}
    <div className="module-tabs">{tabs.map(([key, label]) => <a key={key} href="#" className={tab === key ? 'active' : ''} onClick={e => { e.preventDefault(); setMessage(''); setTab(key) }}>{label}</a>)}</div>
    {tab === 'timetable' && <Timetable staff={leader || teacher} />}
    {tab === 'exams' && <ExamSetup onMessage={setMessage} />}
    {tab === 'review' && <Review onMessage={setMessage} />}
    {tab === 'analytics' && <Analytics />}
    {tab === 'marks' && <TeacherExams onMessage={setMessage} />}
    {tab === 'results' && <FamilyResults />}</>
}

/** Every exam the person may see, by day. Families never see drafts; results open from here once published. */
function Timetable({ staff }: { staff: boolean }) {
  const timetable = useTimetable(), [past, setPast] = useState(false)
  if (timetable.isPending) return <Loading />
  if (timetable.isError) return <ErrorBox message={errorMessage(timetable.error)} />
  const items = past ? timetable.data.items.filter(i => i.date < timetable.data.today).reverse() : upcoming(timetable.data.items, timetable.data.today), days = byDay(items)
  return <section className="panel exam-panel"><div className="panel-heading"><div><h2>{past ? 'Exams held' : 'Upcoming exams'}</h2><p>{items.length} exam{items.length === 1 ? '' : 's'}</p></div><button className="button small secondary" onClick={() => setPast(!past)}>{past ? 'Show upcoming' : 'Show held'}</button></div>
    {!days.length ? <Empty title={past ? 'No exams held yet' : 'No upcoming exams'} description={staff ? 'Scheduled exams for your classes appear here.' : 'The school has not scheduled any exams yet.'} /> : days.map(d => <div key={d.date} className="exam-day"><h3>{dayLabel(d.date)}</h3>
      <ul className="dash-list exam-list">{d.items.map(e => <li key={e.id}><span className="stat-icon blue"><ClipboardList size={17} /></span><div><strong>{e.name} · {e.subjectName}</strong><small>{e.className}{timeLabel(e) ? ' · ' + timeLabel(e) : ''}{e.room ? ' · ' + e.room : ''}{e.term ? ' · ' + e.term : ''}{e.instructions ? ' · ' + e.instructions : ''}</small></div>{staff ? <span className={'status-tag ' + statusTone(e.status)}>{STATUS_LABEL[e.status]}</span> : e.resultsVisible ? <span className="status-tag active">Results published</span> : null}</li>)}</ul></div>)}</section>
}

/** Leadership: every exam with its stage and entry progress, the editor, and the stage buttons. */
function ExamSetup({ onMessage }: { onMessage: (m: string) => void }) {
  const cache = useQueryClient(), can = useAuthStore(s => s.user?.permissions.includes('exams.manage') ?? false), overview = useExamOverview(), options = useOptions()
  const [filter, setFilter] = useState<'all' | ExamStatus>('all'), [editing, setEditing] = useState<{ id?: string, version?: number, draft: Draft } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [sheet, setSheet] = useState<OverviewExam | null>(null)
  const items = overview.data?.items ?? [], shown = items.filter(i => filter === 'all' || i.status === filter)
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!editing) return; setBusy(true); setError('')
    const body = { ...editing.draft, maxMarks: editing.draft.maxMarks || '100', passMarks: editing.draft.passMarks || '0' }
    try { if (editing.id) await client.put('/suite/records/exams/' + editing.id, { ...body, version: editing.version }); else await client.post('/suite/records/exams', body); onMessage(editing.id ? 'Exam saved.' : 'Exam created as a draft. Schedule it when the timetable is final.'); setEditing(null); await refreshAll(cache) }
    catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return <>{overview.isError ? <ErrorBox message={errorMessage(overview.error)} /> : <>
    <div className="stats-grid"><div className="stat-card"><strong>{overview.data?.totals.exams ?? '—'}</strong><h2>Exams</h2><p>{overview.data?.totals.Published ?? 0} published</p></div><div className="stat-card"><strong>{overview.data?.totals.pendingApproval ?? '—'}</strong><h2>Awaiting approval</h2><p>Submitted by teachers</p></div><div className="stat-card"><strong>{overview.data?.totals.entryIncomplete ?? '—'}</strong><h2>Entry incomplete</h2><p>Open exams with marks missing</p></div><div className="stat-card"><strong>{overview.data ? overview.data.totals.entered + ' / ' + overview.data.totals.expected : '—'}</strong><h2>Marks entered</h2><p>Across every exam</p></div></div>
    <div className="attendance-toolbar"><label>Status<select value={filter} onChange={e => setFilter(e.target.value as 'all' | ExamStatus)}><option value="all">All</option>{STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
      <div className="attendance-toolbar-actions">{can && <button className="button primary" onClick={() => { setError(''); setEditing({ draft: emptyDraft(today()) }) }}><Plus size={16} />New exam</button>}</div></div>
    <section className="panel exam-panel">{overview.isPending ? <Loading /> : !shown.length ? <Empty title={items.length ? 'Nothing here' : 'No exams yet'} description={items.length ? 'Try another status.' : 'Create an exam for a class and subject, then schedule it.'} /> : <div className="table-scroll"><table>
      <thead><tr><th>Exam</th><th>Class · subject</th><th>Date</th><th>Scheme</th><th>Status</th><th>Marks entered</th><th>Actions</th></tr></thead>
      <tbody>{shown.map(i => <tr key={i.id}><td><strong>{i.name}</strong>{i.term ? <small className="muted"> · {i.term}</small> : null}</td><td>{i.className} · {i.subjectName}</td><td>{dayLabel(i.date)}{timeLabel(i) ? <small className="muted"> · {timeLabel(i)}</small> : null}</td><td>{i.schemeName || `Marks out of ${i.maxMarks}`}</td><td><span className={'status-tag ' + statusTone(i.status)}>{STATUS_LABEL[i.status]}</span></td>
        <td>{i.entered} of {i.assigned}{i.missing && STATUSES.indexOf(i.status) >= 3 ? <small className="muted"> · {i.missing} missing</small> : null}</td>
        <td><div className="row-actions"><button className="button small secondary" onClick={() => setSheet(i)}>Marks</button>{can && <button className="button small secondary" onClick={() => { setError(''); setEditing({ id: i.id, version: i.version, draft: toDraft(i) }) }}>Edit</button>}{can && <StageButtons exam={i} entered={i.entered} leadership onDone={m => { onMessage(m); return refreshAll(cache) }} />}</div></td></tr>)}</tbody></table></div>}</section></>}
    {editing && <Dialog title={editing.id ? 'Edit exam' : 'New exam'} onClose={() => !busy && setEditing(null)}><form onSubmit={save}>{error && <ErrorBox message={error} />}
      <div className="form-grid">
        <label className="full-width">Exam name<input required maxLength={255} value={editing.draft.name} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, name: e.target.value } })} placeholder="Half-yearly examination" /></label>
        <label>Academic year<select value={editing.draft.yearId} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, yearId: e.target.value } })}><option value="">Not set</option>{options.data?.['academic-years']?.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <label>Term<input maxLength={60} value={editing.draft.term} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, term: e.target.value } })} placeholder="Term 1" /></label>
        <label>Class<select required value={editing.draft.classId} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, classId: e.target.value } })}><option value="">Select class</option>{options.data?.classes?.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <label>Subject<select required value={editing.draft.subjectId} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, subjectId: e.target.value } })}><option value="">Select subject</option>{options.data?.subjects?.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <label>Assessment scheme<select value={editing.draft.schemeId} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, schemeId: e.target.value } })}><option value="">Plain marks (maximum and pass below)</option>{options.data?.['assessment-schemes']?.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select><small className="muted">{editing.draft.schemeId ? 'The scheme sets the maximum, pass marks and grades.' : 'Create schemes such as Theory 70 + Practical 30 or a grade-only scale under Assessment schemes.'}</small></label>
        <label>Maximum marks<input type="number" min={1} max={1000} step="any" disabled={!!editing.draft.schemeId} value={editing.draft.maxMarks} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, maxMarks: e.target.value } })} /></label>
        <label>Pass marks<input type="number" min={0} max={1000} step="any" disabled={!!editing.draft.schemeId} value={editing.draft.passMarks} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, passMarks: e.target.value } })} /></label>
        <label>Exam date<input type="date" required value={editing.draft.date} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, date: e.target.value } })} /></label>
        <label>Starts at<input type="time" value={editing.draft.startsAt} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, startsAt: e.target.value } })} /></label>
        <label>Ends at<input type="time" value={editing.draft.endsAt} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, endsAt: e.target.value } })} /></label>
        <label>Room / location<input maxLength={100} value={editing.draft.room} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, room: e.target.value } })} /></label>
        <label>Status<select value={editing.draft.status} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, status: e.target.value as ExamStatus } })}>{(editing.id ? STATUSES : ['Draft', 'Scheduled'] as ExamStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
        <label className="full-width">Instructions<textarea rows={3} maxLength={4000} value={editing.draft.instructions} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, instructions: e.target.value } })} placeholder="Bring a calculator; arrive 15 minutes early." /></label>
      </div>
      <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save exam'}</button></div></form></Dialog>}
    {sheet && <MarksheetDialog exam={sheet} onClose={() => setSheet(null)} onMessage={onMessage} />}</>
}

/** The stage buttons for one exam; a return or an unpublish asks for a reason first. */
function StageButtons({ exam, entered, leadership, teacher, onDone }: { exam: Exam, entered: number, leadership?: boolean, teacher?: boolean, onDone: (message: string) => Promise<unknown> }) {
  const [asking, setAsking] = useState<{ to: ExamStatus, label: string } | null>(null), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const actions = nextActions(exam.status, { leadership: !!leadership, teacher: !!teacher, entered })
  async function move(to: ExamStatus, label: string, why = '') {
    setBusy(true); setError('')
    try { await client.post(`/suite/exams/${exam.id}/transition`, { to, reason: why, version: exam.version }); setAsking(null); setReason(''); await onDone(to === 'Published' ? 'Results published. Students and families can see them now.' : to === 'Submitted' ? 'Marks submitted for approval.' : label + ': done.') }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  return <>{actions.map(a => <button key={a.to} className={'button small ' + (a.secondary ? 'secondary' : 'primary')} disabled={busy} onClick={() => a.reason ? setAsking({ to: a.to, label: a.label }) : move(a.to, a.label)}>{a.label}</button>)}
    {error && <span className="form-error" role="alert">{error}</span>}
    {asking && <Dialog title={asking.label + ' · ' + exam.name} onClose={() => !busy && setAsking(null)}><label>Reason<textarea rows={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="What the teacher should look at" /></label>{error && <ErrorBox message={error} />}
      <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={() => setAsking(null)}>Cancel</button><button type="button" className="button primary" disabled={busy || !reason.trim()} onClick={() => move(asking.to, asking.label, reason.trim())}>{asking.label}</button></div></Dialog>}</>
}

/** Leadership: what teachers have submitted, what is incomplete, and the approve, return and publish actions. */
function Review({ onMessage }: { onMessage: (m: string) => void }) {
  const cache = useQueryClient(), can = useAuthStore(s => s.user?.permissions.includes('exams.manage') ?? false), overview = useExamOverview(), [sheet, setSheet] = useState<OverviewExam | null>(null)
  if (overview.isPending) return <Loading />
  if (overview.isError) return <ErrorBox message={errorMessage(overview.error)} />
  const queue = overview.data.items.filter(i => i.status === 'Submitted' || i.status === 'Approved' || i.status === 'MarksEntry')
  return <><section className="panel exam-panel"><div className="panel-heading"><div><h2>Review queue</h2><p>Submitted marks wait here for approval; approved marks wait to be published.</p></div></div>
    {!queue.length ? <Empty title="Nothing to review" description="Marks submitted by teachers appear here." /> : <div className="table-scroll"><table><thead><tr><th>Exam</th><th>Class · subject</th><th>Stage</th><th>Entered</th><th>Absent · exempt</th><th>Average</th><th>Actions</th></tr></thead>
      <tbody>{queue.map(i => <tr key={i.id}><td><strong>{i.name}</strong>{i.submittedAt ? <small className="muted"> · submitted {new Date(i.submittedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small> : null}{i.returnReason && i.status === 'MarksEntry' ? <small className="muted"> · returned: {i.returnReason}</small> : null}</td><td>{i.className} · {i.subjectName}</td><td><span className={'status-tag ' + statusTone(i.status)}>{STATUS_LABEL[i.status]}</span></td>
        <td>{i.entered} of {i.assigned}{i.missing ? <span className="status-tag important"> {i.missing} missing</span> : null}</td><td>{i.absent} · {i.exempt}</td><td>{i.average === null ? '—' : i.average + '%'}</td>
        <td><div className="row-actions"><button className="button small secondary" onClick={() => setSheet(i)}>Open marks</button>{can && <StageButtons exam={i} entered={i.entered} leadership onDone={m => { onMessage(m); return refreshAll(cache) }} />}</div></td></tr>)}</tbody></table></div>}</section>
    {sheet && <MarksheetDialog exam={sheet} onClose={() => setSheet(null)} onMessage={onMessage} />}</>
}

/** Leadership: how marks entry is going and how the school is doing, without ranking anyone. */
function Analytics() {
  const overview = useExamOverview()
  if (overview.isPending) return <Loading />
  if (overview.isError) return <ErrorBox message={errorMessage(overview.error)} />
  const a = analytics(overview.data.items), total = a.passed + a.failed
  return <><div className="stats-grid"><div className="stat-card"><strong>{a.expected ? Math.round(a.entered / a.expected * 100) + '%' : '—'}</strong><h2>Marks entry</h2><p>{a.entered} of {a.expected} entered</p></div><div className="stat-card"><strong>{a.pendingApproval}</strong><h2>Awaiting approval</h2><p>{a.entryIncomplete} open with gaps</p></div><div className="stat-card"><strong>{total ? Math.round(a.passed / total * 100) + '%' : '—'}</strong><h2>Pass rate</h2><p>{a.passed} passed · {a.failed} below pass, published exams</p></div><div className="stat-card"><strong>{a.published}</strong><h2>Published exams</h2><p>With marks entered</p></div></div>
    <div className="dashboard-grid">
      <section className="panel exam-panel"><div className="panel-heading"><div><h2>Class averages</h2><p>Published exams</p></div></div>{!a.classes.length ? <Empty title="No published results yet" description="Averages appear once results are published." /> : <div className="class-bars">{a.classes.map(c => <div key={c.name}><span>{c.name}</span><div><i style={{ width: Math.min(100, c.average) + '%' }} /></div><strong>{c.average}%</strong></div>)}</div>}</section>
      <section className="panel exam-panel"><div className="panel-heading"><div><h2>Subject averages</h2><p>Published exams</p></div></div>{!a.subjects.length ? <Empty title="No published results yet" description="Averages appear once results are published." /> : <div className="class-bars">{a.subjects.map(c => <div key={c.name}><span>{c.name}</span><div><i style={{ width: Math.min(100, c.average) + '%' }} /></div><strong>{c.average}%</strong></div>)}</div>}</section>
    </div>
    <div className="dashboard-grid">
      <section className="panel exam-panel"><div className="panel-heading"><div><h2>Grade distribution</h2><p>Across published exams</p></div></div>{!Object.keys(a.distribution).length ? <Empty title="No grades yet" description="Grades are worked out from each exam's scheme." /> : <div className="kpi-row">{Object.entries(a.distribution).map(([g, n]) => <div key={g}><span>{g}</span><strong>{n}</strong></div>)}</div>}</section>
      <section className="panel exam-panel"><div className="panel-heading"><div><h2>Students needing attention</h2><p>Below pass marks in published exams</p></div></div>{!overview.data.attention.length ? <Empty title="Nobody below pass marks" description="Students who fall below pass marks in a published exam are listed here." /> : <ul className="dash-list">{overview.data.attention.map(s => <li key={s.studentId}><span className="stat-icon peach"><ClipboardList size={17} /></span><div><strong>{s.name}</strong><small>{s.className} · {s.subjects}</small></div><span className="status-tag important">{s.failed} subject{s.failed === 1 ? '' : 's'}</span></li>)}</ul>}</section>
    </div></>
}

/** Teacher: the exams of their classes with entry progress, opening the marksheet. */
function TeacherExams({ onMessage }: { onMessage: (m: string) => void }) {
  const overview = useExamOverview(), [sheet, setSheet] = useState<OverviewExam | null>(null)
  if (overview.isPending) return <Loading />
  if (overview.isError) return <ErrorBox message={errorMessage(overview.error)} />
  const items = overview.data.items
  return <><section className="panel exam-panel"><div className="panel-heading"><div><h2>Marks entry</h2><p>Open an exam, enter marks for the class, save as you go, then submit for approval.</p></div></div>
    {!items.length ? <Empty title="No exams for your classes" description="Exams scheduled for your classes and subjects appear here." /> : <div className="table-scroll"><table><thead><tr><th>Exam</th><th>Class · subject</th><th>Date</th><th>Stage</th><th>Entered</th><th>Actions</th></tr></thead>
      <tbody>{items.map(i => <tr key={i.id}><td><strong>{i.name}</strong>{i.returnReason && i.status === 'MarksEntry' ? <small className="muted"> · returned: {i.returnReason}</small> : null}</td><td>{i.className} · {i.subjectName}</td><td>{dayLabel(i.date)}</td><td><span className={'status-tag ' + statusTone(i.status)}>{STATUS_LABEL[i.status]}</span></td><td>{i.entered} of {i.assigned} · {completion(i)}%</td>
        <td><div className="row-actions"><button className="button small primary" onClick={() => setSheet(i)}>{STATUSES.indexOf(i.status) <= 2 ? 'Enter marks' : 'View marks'}</button></div></td></tr>)}</tbody></table></div>}</section>
    {sheet && <MarksheetDialog exam={sheet} onClose={() => setSheet(null)} onMessage={onMessage} />}</>
}

/**
 * The marksheet: one row per student, one input per component (or a grade), Absent and Exempt, the running total and
 * grade, keyboard moves down the column, save keeps a draft, submit sends it for approval. Read-only once submitted.
 */
function MarksheetDialog({ exam, onClose, onMessage }: { exam: Exam, onClose: () => void, onMessage: (m: string) => void }) {
  const cache = useQueryClient(), sheet = useSheet(exam.id), leader = isLeadership(useAuthStore(s => s.user?.roles[0]))
  const [drafts, setDrafts] = useState<Record<string, Entry>>({}), [busy, setBusy] = useState(false), [error, setError] = useState(''), [errors, setErrors] = useState<Record<string, string>>({}), grid = useRef<HTMLTableElement>(null)
  useEffect(() => { setDrafts({}); setErrors({}) }, [sheet.data?.exam.version])
  if (sheet.isPending) return <Dialog title={exam.name} onClose={onClose}><Loading /></Dialog>
  if (sheet.isError) return <Dialog title={exam.name} onClose={onClose}><ErrorBox message={errorMessage(sheet.error)} /></Dialog>
  const { scheme, students, canEdit, canSubmit } = sheet.data, live = sheet.data.exam
  const entry = (row: SheetRow) => drafts[row.studentId] ?? toEntry(row, scheme)
  const set = (row: SheetRow, patch: Partial<Entry>) => setDrafts(d => ({ ...d, [row.studentId]: { ...entry(row), ...patch } }))
  const pending = changedEntries(students, drafts, scheme), problems = students.filter(r => entryProblem(entry(r), scheme))
  function keys(e: KeyboardEvent<HTMLElement>, rowIndex: number, col: number) {
    if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault(); const next = grid.current?.querySelector<HTMLElement>(`[data-row="${rowIndex + (e.key === 'ArrowUp' ? -1 : 1)}"][data-col="${col}"]`); next?.focus(); if (next instanceof HTMLInputElement) next.select()
  }
  async function send(submit: boolean) {
    setBusy(true); setError(''); setErrors({})
    try {
      const r = await client.post(`/suite/exams/${exam.id}/marksheet`, { entries: pending, submit })
      const failed: Record<string, string> = {}; for (const f of r.data.data.errors as { studentId: string, message: string }[]) failed[f.studentId] = f.message
      setErrors(failed); if (!Object.keys(failed).length) setDrafts({})
      onMessage(Object.keys(failed).length ? `${r.data.data.saved} saved; ${Object.keys(failed).length} row${Object.keys(failed).length === 1 ? '' : 's'} need attention.` : submit ? 'Marks submitted for approval.' : `${r.data.data.saved} mark${r.data.data.saved === 1 ? '' : 's'} saved.`)
      await refreshAll(cache); if (submit && !Object.keys(failed).length) onClose()
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  const columns = scheme.gradeOnly ? 1 : scheme.components.length
  return <Dialog title={live.name + ' · ' + live.className + ' · ' + live.subjectName} onClose={() => !busy && onClose()}>
    <p className="muted">{dayLabel(live.date)}{timeLabel(live) ? ' · ' + timeLabel(live) : ''} · {live.schemeName || 'Marks'}{scheme.gradeOnly ? ' · grades ' + scheme.grades.map(g => g.label).join(', ') : ' · out of ' + scheme.max + (scheme.passMarks !== null ? ', pass ' + scheme.passMarks : '')} · <span className={'status-tag ' + statusTone(live.status)}>{STATUS_LABEL[live.status]}</span>{live.returnReason && live.status === 'MarksEntry' ? ' · returned: ' + live.returnReason : ''}</p>
    {error && <ErrorBox message={error} />}
    {!students.length ? <Empty title="No students in this class" description="Allocate students to the class to enter marks." /> : <div className="table-scroll marks-grid"><table ref={grid}><thead><tr><th>Student</th><th>Attendance</th>{scheme.gradeOnly ? <th>Grade</th> : scheme.components.map(c => <th key={c.name}>{scheme.type === 'Marks' ? 'Marks' : c.name} <small className="muted">/ {c.max}</small></th>)}{!scheme.gradeOnly && <th>Total · grade</th>}<th>Remarks</th></tr></thead>
      <tbody>{students.map((row, i) => { const v = entry(row), total = entryTotal(v, scheme), problem = errors[row.studentId] || entryProblem(v, scheme), present = v.status === 'Present'; return <tr key={row.studentId} className={problem ? 'invalid' : drafts[row.studentId] ? 'edited' : ''}>
        <td><strong>{row.name}</strong><small className="muted"> {row.code}</small>{problem && <small className="form-error" role="alert"> {problem}</small>}</td>
        <td>{canEdit ? <select aria-label={'Attendance for ' + row.name} data-row={i} data-col={0} value={v.status} onKeyDown={e => keys(e, i, 0)} onChange={e => set(row, { status: e.target.value as Entry['status'] })}>{MARK_STATUSES.map(s => <option key={s}>{s}</option>)}</select> : <span className="status-tag">{v.status}</span>}</td>
        {scheme.gradeOnly ? <td>{canEdit && present ? <input aria-label={'Grade for ' + row.name} data-row={i} data-col={1} list={'grades-' + exam.id} value={v.grade} maxLength={10} onKeyDown={e => keys(e, i, 1)} onChange={e => set(row, { grade: e.target.value })} /> : <span>{present ? v.grade || '—' : v.status}</span>}</td>
          : scheme.components.map((c, col) => <td key={c.name}>{canEdit && present ? <input aria-label={(scheme.type === 'Marks' ? 'Marks' : c.name) + ' for ' + row.name} data-row={i} data-col={col + 1} type="number" inputMode="decimal" min={0} max={c.max} step="any" value={v.components[c.name] ?? ''} onKeyDown={e => keys(e, i, col + 1)} onChange={e => set(row, { components: { ...v.components, [c.name]: e.target.value } })} /> : <span>{present ? v.components[c.name] || '—' : '—'}</span>}</td>)}
        {!scheme.gradeOnly && <td>{present ? total === null ? <span className="muted">—</span> : <><strong>{total}</strong> / {scheme.max}{scheme.grades.length ? <small className="muted"> · {gradeFor(scheme, scheme.max ? total / scheme.max * 100 : 0)}</small> : null}</> : <span className="status-tag">{v.status === 'Absent' ? 'AB' : 'EX'}</span>}</td>}
        <td>{canEdit ? <input aria-label={'Remarks for ' + row.name} data-row={i} data-col={columns + 1} value={v.remarks} maxLength={500} onKeyDown={e => keys(e, i, columns + 1)} onChange={e => set(row, { remarks: e.target.value })} /> : <span>{v.remarks || '—'}</span>}</td></tr> })}</tbody></table>
      {scheme.gradeOnly && <datalist id={'grades-' + exam.id}>{scheme.grades.map(g => <option key={g.label} value={g.label} />)}</datalist>}</div>}
    <p className="muted">{sheet.data.entered} of {students.length} entered{pending.length ? ` · ${pending.length} unsaved` : ''}{problems.length ? ` · ${problems.length} to fix` : ''}. Enter or the arrow keys move down the column.</p>
    <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Close</button>
      {canEdit && <button type="button" className="button secondary" disabled={busy || !pending.length || problems.length > 0} onClick={() => send(false)}><Check size={15} />{busy ? 'Saving…' : 'Save marks'}</button>}
      {(canSubmit || (canEdit && !leader && pending.length > 0)) && <button type="button" className="button primary" disabled={busy || problems.length > 0 || (!pending.length && !canSubmit)} onClick={() => send(true)}><Send size={15} />Save and submit for approval</button>}</div>
  </Dialog>
}

/** Families: published results per child with the scheme's components, and the printable report card. */
function FamilyResults() {
  const user = useAuthStore(s => s.user), student = user?.roles[0] === 'Student', options = useOptions()
  const children = options.data?.students ?? [], [chosen, setChosen] = useState(''), child = children.find(c => c.id === chosen) ?? children[0]
  const report = useReport(child?.id), [error, setError] = useState('')
  async function print() { setError(''); try { if (!report.data?.results.length) throw new Error('There are no published results yet.'); printSchoolDocument('report', report.data) } catch (e) { setError(errorMessage(e)) } }
  if (options.isPending) return <Loading />
  if (!child) return <section className="panel"><Empty title={student ? 'Your student record is not linked yet' : 'No children linked yet'} description="Ask the school administrator to link this account to the student record." /></section>
  return <>{!student && children.length > 1 && <div className="attendance-toolbar"><label className="child-switcher">Child<select aria-label="Choose child" value={child.id} onChange={e => setChosen(e.target.value)}>{children.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label></div>}
    {error && <ErrorBox message={error} />}
    {report.isPending ? <Loading /> : report.isError ? <ErrorBox message={errorMessage(report.error)} /> : <>
      <div className="stats-grid"><div className="stat-card"><strong>{report.data.maximum ? report.data.percent + '%' : '—'}</strong><h2>Overall</h2><p>{report.data.maximum ? report.data.obtained + ' of ' + report.data.maximum + ' marks' : 'No marks-based results yet'}</p></div><div className="stat-card"><strong>{report.data.grade}</strong><h2>Grade</h2><p>Across published exams</p></div><div className="stat-card"><strong>{report.data.passed}</strong><h2>Subjects passed</h2><p>{report.data.failed} below pass marks</p></div><div className="stat-card"><strong>{report.data.attendance?.percent ?? '—'}{report.data.attendance?.percent != null ? '%' : ''}</strong><h2>Attendance</h2><p>{report.data.attendance ? `${report.data.attendance.markedDays} days marked` : 'No academic year set'}</p></div></div>
      <section className="panel exam-panel"><div className="panel-heading"><div><h2>Published results</h2><p>{child.label}{report.data.year ? ' · ' + report.data.year : ''}</p></div><button className="button secondary" disabled={!report.data.results.length} onClick={print}><Printer size={15} />Report card</button></div>
        {!report.data.results.length ? <Empty title="No published results yet" description="Results appear here once the school publishes an exam." /> : <div className="table-scroll"><table><thead><tr><th>Exam</th><th>Subject</th><th>Marks</th><th>Grade</th><th>Result</th><th>Remarks</th></tr></thead>
          <tbody>{report.data.results.map((r, i) => <tr key={i}><td><strong>{r.exam}</strong>{r.term ? <small className="muted"> · {r.term}</small> : null}</td><td>{r.subject}</td><td>{r.status === 'Present' ? (r.maximum == null ? '—' : `${r.score} / ${r.maximum}`) : r.status}{componentsLabel(r.components) ? <small className="muted"> · {componentsLabel(r.components)}</small> : null}</td><td>{r.grade || '—'}</td><td>{r.status === 'Exempt' ? <span className="status-tag">Exempt</span> : <span className={'status-tag ' + (r.pass ? 'active' : 'important')}>{r.pass ? 'Pass' : 'Below pass marks'}</span>}</td><td>{r.remarks || '—'}</td></tr>)}</tbody></table></div>}
        <p className="muted">{report.data.note}</p></section></>}</>
}
export { marksLabel }
