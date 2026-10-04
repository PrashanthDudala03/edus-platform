import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, CalendarCheck, ClipboardList, FileText, Printer, Search, Users, Wallet } from 'lucide-react'
import client, { errorMessage } from '../api/client'
import { useAuthStore } from '../store/auth'
import { Empty, ErrorBox, Loading, PageHeader, today } from '../components/UI'
import { data, printSchoolDocument, type Options } from './suite/helpers'
import { AttendanceDays } from './suite/AttendancePages'
import { TAB_LABEL, attendanceNote, byDay, dayLabel, examsNote, feesNote, homeworkNote, initials, isTab, kindTone, money, pct, resultLabel, tabsFor, type Event, type Student360, type Tab, type Timeline } from './suite/student360'
import { GROUP_LABEL, type Group } from './suite/homework'

// Student 360: one place that answers "what is happening with this student?". The server composes the picture from
// the register, homework, exams, fees, documents and notices with each module's own scope rule, so a student sees
// only themself, a parent only linked children, a teacher only their classes, and the office the whole school.
export const useStudent360 = (id: string | undefined) => useQuery<Student360>({ queryKey: ['suite', 'student360', id], enabled: !!id, queryFn: () => data('/students/' + id + '/360') })
export function Student360Link({ studentId, label = 'Student 360' }: { studentId: string, label?: string }) { return <Link className="button secondary" to={'/student360/' + studentId}><Users size={15} />{label}</Link> }

export default function Student360Page() {
  const { id } = useParams(), user = useAuthStore(s => s.user), role = user?.roles[0] ?? ''
  const options = useQuery<Options>({ queryKey: ['suite', 'options'], queryFn: () => data('/options') }), navigate = useNavigate(), [search, setSearch] = useState('')
  const students = options.data?.students ?? []
  // A student has one record and goes straight to it; a parent with one child too.
  if (!id && !options.isPending && students.length === 1) { navigate('/student360/' + students[0].id, { replace: true }); return <Loading /> }
  if (id) return <Student360View id={id} role={role} />
  const shown = students.filter(s => s.label.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 50)
  return <><PageHeader eyebrow={role === 'Parent' ? 'MY CHILDREN' : 'STUDENT 360'} title={role === 'Parent' ? 'Choose a child' : 'Find a student'} description={role === 'Teacher' ? 'Students in your classes.' : role === 'Parent' ? 'Everything about each child in one place.' : 'Everything about a student in one place: attendance, homework, exams, fees, documents and a timeline.'} />
    {options.isPending ? <Loading /> : options.isError ? <ErrorBox message={errorMessage(options.error)} /> : !students.length ? <section className="panel"><Empty title={role === 'Student' ? 'Your student record is not linked yet' : role === 'Parent' ? 'No children linked yet' : 'No students in your scope'} description={role === 'Teacher' ? 'Students appear once classes are assigned to you.' : 'Ask the school administrator to link this account to the student record.'} /></section>
      : <section className="panel"><div className="attendance-toolbar"><label>Find<span className="search-field"><Search size={16} /><input type="search" value={search} placeholder="Name" onChange={e => setSearch(e.target.value)} aria-label="Find a student" /></span></label></div>
        <ul className="dash-list s360-pick">{shown.map((s, i) => <li key={s.id}><span className={'person-avatar tone-' + i % 4}>{initials(s.label)}</span><div><strong>{s.label}</strong></div><Link className="button small secondary" to={'/student360/' + s.id}>Open</Link></li>)}</ul>
        {shown.length === 50 && <p className="muted">Showing the first 50. Type more of the name.</p>}</section>}</>
}

function Student360View({ id, role }: { id: string, role: string }) {
  const view = useStudent360(id), [params, setParams] = useSearchParams(), [error, setError] = useState('')
  if (view.isPending) return <Loading />
  if (view.isError) return <><PageHeader eyebrow="STUDENT 360" title="Student" description="" /><ErrorBox message={errorMessage(view.error)} /></>
  const v = view.data, s = v.student, tabs = tabsFor(v.visibility), tab: Tab = isTab(params.get('tab'), v.visibility) ? (params.get('tab') as Tab) : 'overview'
  const pick = (t: Tab) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true })
  async function print() { setError(''); try { const r = await data('/report-cards/' + id); if (!r.results.length) throw new Error('There are no published results yet.'); printSchoolDocument('report', r) } catch (e) { setError(errorMessage(e)) } }
  return <>
    <section className="panel s360-header">
      <span className="person-avatar tone-1 s360-avatar" aria-hidden="true">{initials(s.name)}</span>
      <div className="s360-identity"><span className="eyebrow">{role === 'Student' ? 'MY SCHOOL PROFILE' : 'STUDENT 360'}</span><h1>{s.name}</h1>
        <p className="muted">{[s.admissionNumber && 'Admission ' + s.admissionNumber, s.className || 'Class not allocated', s.year].filter(Boolean).join(' · ')}</p>
        <div className="s360-chips"><span className={'status-tag ' + (s.status === 'Active' ? 'active' : '')}>{s.status || 'Status unknown'}</span>{s.guardians.map(g => <span key={g.name + g.relationship} className="status-tag">{g.relationship === 'parent' ? 'Guardian' : 'Student account'}: {g.name}</span>)}</div>
        {v.visibility.contact && (s.email || s.phone || s.dateOfBirth) && <dl className="s360-contact">{s.email && <div><dt>Email</dt><dd>{s.email}</dd></div>}{s.phone && <div><dt>Phone</dt><dd>{s.phone}</dd></div>}{s.dateOfBirth && <div><dt>Born</dt><dd>{String(s.dateOfBirth).slice(0, 10)}</dd></div>}{s.guardians.filter(g => g.email).map(g => <div key={g.email}><dt>{g.relationship === 'parent' ? 'Guardian' : 'Account'}</dt><dd>{g.email}</dd></div>)}</dl>}
      </div>
      <div className="s360-actions">{role !== 'Student' && role !== 'Parent' && <Link className="button secondary" to="/student360">Another student</Link>}<button className="button secondary" onClick={print}><Printer size={15} />Report card</button></div>
    </section>
    {error && <ErrorBox message={error} />}
    <nav className="module-tabs s360-tabs" aria-label="Student sections">{tabs.map(t => <a key={t} href={'?tab=' + t} className={tab === t ? 'active' : ''} aria-current={tab === t ? 'page' : undefined} onClick={e => { e.preventDefault(); pick(t) }}>{TAB_LABEL[t]}</a>)}</nav>
    {tab === 'overview' && <Overview v={v} id={id} pick={pick} />}
    {tab === 'academics' && <AcademicsTab v={v} />}
    {tab === 'attendance' && <AttendanceTab v={v} id={id} />}
    {tab === 'homework' && <HomeworkTab v={v} />}
    {tab === 'exams' && <ExamsTab v={v} onPrint={print} />}
    {tab === 'fees' && <FeesTab v={v} />}
    {tab === 'documents' && <DocumentsTab v={v} />}
    {tab === 'timeline' && <TimelineTab first={v.timeline} id={id} />}
  </>
}

function Card({ title, value, note, icon: Icon, tone, onClick }: { title: string, value: string, note: string, icon: typeof BookOpen, tone: string, onClick?: () => void }) {
  return <div className="stat-card s360-card" role="button" tabIndex={0} onClick={onClick} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.() } }}><span className={'stat-icon ' + tone}><Icon size={18} /></span><strong>{value}</strong><h2>{title}</h2><p>{note}</p></div>
}

function Overview({ v, id, pick }: { v: Student360, id: string, pick: (t: Tab) => void }) {
  const a = v.attendance.thisMonth, h = v.homework, e = v.exams, f = v.fees
  return <>
    <div className="stats-grid s360-grid">
      <Card title="Attendance this month" value={pct(a.percent)} note={attendanceNote(a)} icon={CalendarCheck} tone="teal" onClick={() => pick('attendance')} />
      <Card title="Homework completion" value={pct(h.completion)} note={homeworkNote(h)} icon={BookOpen} tone="blue" onClick={() => pick('homework')} />
      <Card title="Published results" value={e.published ? pct(e.percent) : '—'} note={examsNote(e)} icon={ClipboardList} tone="peach" onClick={() => pick('exams')} />
      {f.available ? <Card title="Outstanding fees" value={f.charges ? money(f.currency, f.outstanding) : '—'} note={feesNote(f)} icon={Wallet} tone="purple" onClick={() => pick('fees')} /> : <div className="stat-card s360-card"><span className="stat-icon purple"><Wallet size={18} /></span><strong>—</strong><h2>Fees</h2><p>{f.reason}</p></div>}
    </div>
    <div className="dashboard-grid">
      <section className="panel"><div className="panel-heading"><div><h2>Upcoming exams</h2><p>{e.upcoming.length ? 'Next on the timetable' : 'Nothing scheduled'}</p></div><Link className="text-link" to="/suite/exams">All exams</Link></div>
        {!e.upcoming.length ? <Empty title="No upcoming exams" description="Scheduled exams for the class appear here." /> : <ul className="dash-list">{e.upcoming.map(x => <li key={x.id}><span className="stat-icon peach"><ClipboardList size={17} /></span><div><strong>{x.name} · {x.subjectName}</strong><small>{dayLabel(x.date)}{x.startsAt ? ' · ' + x.startsAt : ''}{x.room ? ' · ' + x.room : ''}</small></div></li>)}</ul>}</section>
      <section className="panel"><div className="panel-heading"><div><h2>Homework due</h2><p>{h.due.length ? 'Soonest first' : 'Nothing due'}</p></div><Link className="text-link" to="/suite/homework">All homework</Link></div>
        {!h.due.length ? <Empty title="No homework due" description="Work that is due, due today or missing appears here." /> : <ul className="dash-list">{h.due.map(x => <li key={x.id}><span className="stat-icon blue"><BookOpen size={17} /></span><div><strong>{x.title}</strong><small>{x.subject} · due {dayLabel(x.dueDate)}{x.dueTime ? ' ' + x.dueTime : ''}</small></div><span className={'status-tag ' + (x.group === 'missing' ? 'important' : '')}>{GROUP_LABEL[x.group as Group] ?? x.group}</span></li>)}</ul>}</section>
    </div>
    <div className="dashboard-grid">
      <section className="panel"><div className="panel-heading"><div><h2>Recent notices</h2><p>For this class and its families</p></div><Link className="text-link" to="/suite/circulars">All circulars</Link></div>
        {!v.notices.length ? <Empty title="No notices yet" description="Circulars for the class appear here." /> : <ul className="dash-list">{v.notices.map(n => <li key={n.id}><span className="stat-icon teal"><FileText size={17} /></span><div><strong>{n.title}</strong><small>{dayLabel(n.createdAt)}{n.dueDate ? ' · acknowledge by ' + dayLabel(n.dueDate) : ''}</small></div></li>)}</ul>}</section>
      <section className="panel"><div className="panel-heading"><div><h2>Latest activity</h2><p>From every module</p></div><a href="?tab=timeline" className="text-link" onClick={ev => { ev.preventDefault(); pick('timeline') }}>Full timeline</a></div>
        {!v.timeline.items.length ? <Empty title="Nothing recorded yet" description="Attendance, homework, results, fees and documents appear here as they happen." /> : <ul className="dash-list">{v.timeline.items.slice(0, 6).map((x, i) => <EventRow key={i} e={x} />)}</ul>}</section>
    </div>
    {!v.academics.allocated && <p className="info-box">This student is not allocated to a class yet, so homework, exams and subjects cannot be shown. Allocate the class under Class allocation.</p>}
    <p className="muted">Picture as of {new Date(v.generatedAt).toLocaleString('en-IN')}. Figures come from the register, homework, exams and fees modules and are never estimated.</p>
  </>
}

function AcademicsTab({ v }: { v: Student360 }) {
  const a = v.academics
  return <div className="dashboard-grid">
    <section className="panel"><div className="panel-heading"><div><h2>Enrolment</h2><p>Current allocation</p></div></div>
      <dl className="s360-list"><div><dt>Academic year</dt><dd>{a.year || '—'}{a.yearStatus ? ' · ' + a.yearStatus : ''}</dd></div><div><dt>Class</dt><dd>{a.className || '—'}</dd></div><div><dt>Section</dt><dd>{a.section || '—'}</dd></div><div><dt>Class teacher</dt><dd>{a.classTeacher || '—'}</dd></div><div><dt>Admission</dt><dd>{v.student.admissionNumber || '—'}{v.student.admissionDate ? ' · since ' + String(v.student.admissionDate).slice(0, 10) : ''}</dd></div></dl>
      {!a.allocated && <p className="muted">Not allocated to a class yet.</p>}</section>
    <section className="panel"><div className="panel-heading"><div><h2>Subjects and teachers</h2><p>From teaching assignments</p></div></div>
      {!a.subjects.length ? <Empty title="No subjects assigned" description="Teaching assignments for the class appear here." /> : <div className="table-scroll"><table><thead><tr><th>Subject</th><th>Teacher</th></tr></thead><tbody>{a.subjects.map((x, i) => <tr key={i}><td>{x.subject}</td><td>{x.teacher || '—'}</td></tr>)}</tbody></table></div>}</section>
  </div>
}

function AttendanceTab({ v, id }: { v: Student360, id: string }) {
  const a = v.attendance, [month, setMonth] = useState(a.month)
  const S = ({ s, title }: { s: typeof a.year, title: string }) => <section className="panel"><div className="panel-heading"><div><h2>{title}</h2><p>{attendanceNote(s)}</p></div><strong className="s360-big">{pct(s.percent)}</strong></div>
    <div className="kpi-row"><div><span>Present</span><strong>{s.present}</strong></div><div><span>Late</span><strong>{s.late}</strong></div><div><span>Absent</span><strong>{s.absent}</strong></div><div><span>Excused</span><strong>{s.excused}</strong></div></div></section>
  return <>
    <div className="dashboard-grid"><S s={a.thisMonth} title={'This month'} /><S s={a.year} title={'Academic year ' + (v.academics.year || '') + ' · ' + a.from + ' to ' + a.to} /></div>
    <section className="panel"><div className="panel-heading"><div><h2>Marked days</h2><p>With the reason the school recorded</p></div><label className="child-switcher">Month<input type="month" value={month} max={today().slice(0, 7)} onChange={e => setMonth(e.target.value)} aria-label="Attendance month" /></label></div>
      <AttendanceDays studentId={id} month={month} /></section>
  </>
}

function HomeworkTab({ v }: { v: Student360 }) {
  const h = v.homework
  return <>
    <div className="kpi-row s360-kpis">{(['due-today', 'upcoming', 'missing', 'late', 'submitted', 'reviewed', 'excused', 'closed'] as Group[]).map(g => <div key={g}><span>{GROUP_LABEL[g]}</span><strong>{h.counts[g] ?? 0}</strong></div>)}</div>
    <div className="dashboard-grid">
      <section className="panel"><div className="panel-heading"><div><h2>Due and missing</h2><p>{h.assigned} assignment{h.assigned === 1 ? '' : 's'} set · completion {pct(h.completion)}</p></div><Link className="text-link" to="/suite/homework">Homework</Link></div>
        {!h.due.length ? <Empty title="Nothing due" description="Due, due today and missing work appears here." /> : <ul className="dash-list">{h.due.map(x => <li key={x.id}><span className="stat-icon blue"><BookOpen size={17} /></span><div><strong>{x.title}</strong><small>{x.subject} · due {dayLabel(x.dueDate)}{x.dueTime ? ' ' + x.dueTime : ''}</small></div><span className={'status-tag ' + (x.group === 'missing' ? 'important' : '')}>{GROUP_LABEL[x.group as Group] ?? x.group}</span></li>)}</ul>}</section>
      <section className="panel"><div className="panel-heading"><div><h2>Recent teacher feedback</h2><p>Marks and remarks on handed-in work</p></div></div>
        {!h.feedback.length ? <Empty title="No feedback yet" description="Teacher marks and feedback appear here." /> : <ul className="dash-list">{h.feedback.map((x, i) => <li key={i}><span className="stat-icon teal"><BookOpen size={17} /></span><div><strong>{x.title}{x.grade ? ' · ' + x.grade : ''}</strong><small>{x.subject}{x.feedback ? ' · ' + x.feedback : ''}{x.reviewedAt ? ' · ' + dayLabel(x.reviewedAt) : ''}</small></div></li>)}</ul>}</section>
    </div>
  </>
}

function ExamsTab({ v, onPrint }: { v: Student360, onPrint: () => void }) {
  const e = v.exams
  return <>
    <div className="stats-grid"><div className="stat-card"><strong>{e.published ? pct(e.percent) : '—'}</strong><h2>Overall</h2><p>{e.published ? `${e.obtained} of ${e.maximum} marks` : 'No published results yet'}</p></div><div className="stat-card"><strong>{e.published ? e.grade : '—'}</strong><h2>Grade</h2><p>Across published exams</p></div><div className="stat-card"><strong>{e.published ? e.passed : '—'}</strong><h2>Subjects passed</h2><p>{e.published ? `${e.failed} below pass marks` : 'Published exams only'}</p></div><div className="stat-card"><strong>{e.upcoming.length}</strong><h2>Upcoming exams</h2><p>On the timetable</p></div></div>
    <div className="dashboard-grid">
      <section className="panel"><div className="panel-heading"><div><h2>Latest published results</h2><p>Published exams only; nothing unpublished is shown</p></div><button className="button small secondary" onClick={onPrint}><Printer size={14} />Report card</button></div>
        {!e.latest.length ? <Empty title="No published results yet" description="Results appear here once the school publishes an exam." /> : <div className="table-scroll"><table><thead><tr><th>Exam</th><th>Subject</th><th>Marks</th><th>Result</th></tr></thead><tbody>{e.latest.map((r, i) => <tr key={i}><td>{r.exam}{r.term ? <small className="muted"> · {r.term}</small> : null}</td><td>{r.subject}</td><td>{resultLabel(r)}{r.components.length > 1 && <small className="muted"> · {r.components.map(c => c.name + ' ' + (c.score ?? '—') + '/' + c.max).join(' · ')}</small>}</td><td>{r.status === 'Exempt' ? <span className="status-tag">Exempt</span> : <span className={'status-tag ' + (r.pass ? 'active' : 'important')}>{r.pass ? 'Pass' : 'Below pass marks'}</span>}</td></tr>)}</tbody></table></div>}</section>
      <section className="panel"><div className="panel-heading"><div><h2>Upcoming exams</h2><p>Date, time and room</p></div><Link className="text-link" to="/suite/exams">Timetable</Link></div>
        {!e.upcoming.length ? <Empty title="No upcoming exams" description="Scheduled exams for the class appear here." /> : <ul className="dash-list">{e.upcoming.map(x => <li key={x.id}><span className="stat-icon peach"><ClipboardList size={17} /></span><div><strong>{x.name} · {x.subjectName}</strong><small>{dayLabel(x.date)}{x.startsAt ? ' · ' + x.startsAt + (x.endsAt ? '–' + x.endsAt : '') : ''}{x.room ? ' · ' + x.room : ''}</small></div></li>)}</ul>}</section>
    </div>
  </>
}

function FeesTab({ v }: { v: Student360 }) {
  const f = v.fees
  if (!f.available) return <section className="panel"><Empty title="Fees are not shown here" description={f.reason} /></section>
  return <>
    <div className="stats-grid"><div className="stat-card"><strong>{f.charges ? money(f.currency, f.applicable) : '—'}</strong><h2>Total applicable</h2><p>{f.charges} charge{f.charges === 1 ? '' : 's'} after concessions</p></div><div className="stat-card"><strong>{f.charges ? money(f.currency, f.paid) : '—'}</strong><h2>Paid</h2><p>Payments recorded by the office</p></div><div className="stat-card"><strong>{f.charges ? money(f.currency, f.outstanding) : '—'}</strong><h2>Outstanding</h2><p>{feesNote(f)}</p></div></div>
    <section className="panel"><div className="panel-heading"><div><h2>Recent payments</h2><p>Newest first</p></div><Link className="text-link" to="/suite/fees">Fees & receipts</Link></div>
      {!f.recentPayments.length ? <Empty title="No payments yet" description="Payments recorded by the school office appear here." /> : <div className="table-scroll"><table><thead><tr><th>Date</th><th>Fee</th><th>Amount</th><th>Method</th><th>Receipt</th></tr></thead><tbody>{f.recentPayments.map(p => <tr key={p.id}><td>{String(p.paidOn).slice(0, 10)}</td><td>{p.description}</td><td>{money(p.currency, p.amount)}</td><td>{p.method}</td><td>{p.receipt}</td></tr>)}</tbody></table></div>}</section>
  </>
}

function DocumentsTab({ v }: { v: Student360 }) {
  const [error, setError] = useState('')
  async function open(id: string) { setError(''); try { printSchoolDocument('certificate', await data('/certificates/' + id + '/print')) } catch (e) { setError(errorMessage(e)) } }
  return <section className="panel"><div className="panel-heading"><div><h2>Certificates and documents</h2><p>Issued by the school; files stay in the protected document store</p></div><Link className="text-link" to="/suite/certificates">Certificates</Link></div>
    {error && <ErrorBox message={error} />}
    {!v.documents.length ? <Empty title="No documents yet" description="Certificates and ID cards issued to the student appear here." /> : <ul className="dash-list">{v.documents.map(d => <li key={d.id}><span className="stat-icon purple"><FileText size={17} /></span><div><strong>{d.type}</strong><small>{d.number ? d.number + ' · ' : ''}issued {dayLabel(d.issuedOn)}{d.files ? ` · ${d.files} file${d.files === 1 ? '' : 's'}` : ''}</small></div><button className="button small secondary" onClick={() => open(d.id)}>Open</button></li>)}</ul>}</section>
}

function EventRow({ e }: { e: Event }) {
  return <li><span className={'stat-icon ' + kindTone(e.kind)}>{e.kind === 'attendance' ? <CalendarCheck size={17} /> : e.kind === 'homework' ? <BookOpen size={17} /> : e.kind === 'fee' || e.kind === 'payment' ? <Wallet size={17} /> : e.kind === 'document' ? <FileText size={17} /> : <ClipboardList size={17} />}</span><div><strong>{e.title}</strong><small>{[e.detail, new Date(e.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' · ')}</small></div><span className="status-tag">{e.source}</span></li>
}

function TimelineTab({ first, id }: { first: Timeline, id: string }) {
  const [pages, setPages] = useState<Timeline[]>([first]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const last = pages[pages.length - 1], events = pages.flatMap(p => p.items)
  async function more() { setBusy(true); setError(''); try { const r = await client.get('/suite/students/' + id + '/360/timeline', { params: { page: last.page + 1, pageSize: last.pageSize } }); setPages([...pages, r.data.data]) } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) } }
  return <section className="panel s360-timeline"><div className="panel-heading"><div><h2>Timeline</h2><p>{last.total} event{last.total === 1 ? '' : 's'} from the register, homework, exams, fees and documents</p></div></div>
    {error && <ErrorBox message={error} />}
    {!events.length ? <Empty title="Nothing recorded yet" description="Events appear here as the school records them." /> : byDay(events).map(d => <div key={d.day} className="s360-day"><h3>{dayLabel(d.day)}</h3><ul className="dash-list">{d.events.map((e, i) => <EventRow key={i} e={e} />)}</ul></div>)}
    {last.more && <div className="modal-footer"><button className="button secondary" disabled={busy} onClick={more}>{busy ? 'Loading…' : 'Load earlier events'}</button></div>}
    <p className="muted">The timeline is composed from each module’s own records, newest first; a unified event store comes later.</p></section>
}
