import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { GraduationCap, CalendarCheck, BookOpen, ClipboardList, FileText, Printer, Upload } from 'lucide-react'
import { errorMessage } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { Empty, ErrorBox, Loading, PageHeader, today } from '../../components/UI'
import { data, label, printSchoolDocument, type Row } from '../suite/helpers'
import { FeeSummary, Panel, QueryState, RecentCirculars, StatTile, TodayTimetable, UpcomingExams, useOptions, useRecords } from './widgets'
import { AttendanceDays } from '../suite/AttendancePages'
type ReportCard = { results: Row[], obtained: number, maximum: number, percent: number, grade: string }

// Parent and Student portals. The API returns only the students linked to this account, so the child list,
// and every record filtered by it below, can never include another family's child.
export default function FamilyDashboard({ role }: { role: 'Parent' | 'Student' }) {
  const user = useAuthStore(s => s.user), options = useOptions()
  const children = options.data?.students || []
  const [chosen, setChosen] = useState('')
  const child = children.find(c => c.id === chosen) || children[0]
  const allocations = useQuery<Row[]>({ queryKey: ['suite', 'allocations'], queryFn: () => data('/allocations') })
  const placement = allocations.data?.find(a => a.studentId === child?.id)
  if (options.isPending) return <Loading />
  if (options.isError) return <ErrorBox message={errorMessage(options.error)} />
  const student = role === 'Student'
  return <><PageHeader eyebrow={student ? 'STUDENT PORTAL' : 'PARENT PORTAL'} title={student ? 'Hi, ' + (user?.firstName || 'there') + '.' : 'Hello, ' + (user?.firstName || 'there') + '.'} description={student ? 'Your timetable, homework, results and school notices.' : 'Your children’s school day, progress, fees and notices.'} />
    {!children.length ? <section className="panel"><Empty title={student ? 'Your student profile is not linked yet' : 'No children linked yet'} description="Ask the school administrator to link this account to the correct student record." /></section> : <>
      <section className="panel child-profile">
        <span className="person-avatar tone-0">{child!.label.split(' ').map(p => p[0]).slice(0, 2).join('')}</span>
        <div><span className="eyebrow">{student ? 'MY PROFILE' : 'CHILD PROFILE'}</span><h2>{child!.label}</h2><p>{placement?.class || 'Class not allocated yet'}</p></div>
        {!student && children.length > 1 && <label className="child-switcher">Viewing child<select aria-label="Choose child" value={child!.id} onChange={e => setChosen(e.target.value)}>{children.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
      </section>
      <ChildView key={child!.id} studentId={child!.id} classId={placement?.classId} role={role} />
    </>}</>
}

function ChildView({ studentId, classId, role }: { studentId: string, classId?: string, role: 'Parent' | 'Student' }) {
  const month = today().slice(0, 7), options = useOptions()
  const attendance = useQuery<Row[]>({ queryKey: ['suite', 'reports', 'attendance', month], queryFn: () => data('/reports/attendance', { month }) })
  const card = useQuery<ReportCard>({ queryKey: ['suite', 'report-card', studentId], queryFn: () => data('/report-cards/' + studentId) })
  const homework = useRecords('homework'), submissions = useRecords('submissions'), certificates = useRecords('certificates')
  const [error, setError] = useState('')
  const row = attendance.data?.find(r => r.studentId === studentId)
  const marked = Number(row?.markedDays || 0), attended = Number(row?.present || 0) + Number(row?.late || 0)
  const due = (homework.data?.data || []).filter(h => (!classId || h.classId === classId) && String(h.dueDate) >= today()).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
  const submitted = new Set((submissions.data?.data || []).filter(s => s.studentId === studentId).map(s => s.homeworkId))
  const docs = (certificates.data?.data || []).filter(c => c.studentId === studentId)
  async function openReport() { setError(''); try { const r = await data('/report-cards/' + studentId); printSchoolDocument('report', r) } catch (e) { setError(errorMessage(e)) } }
  async function printCertificate(id: string) { setError(''); try { printSchoolDocument('certificate', await data('/certificates/' + id + '/print')) } catch (e) { setError(errorMessage(e)) } }
  return <>
    {error && <ErrorBox message={error} />}
    <div className="stats-grid">
      <StatTile label="Attendance this month" value={marked ? Math.round(attended / marked * 100) + '%' : '—'} note={marked ? attended + ' of ' + marked + ' school days present' : 'No days marked yet'} icon={CalendarCheck} tone="teal" to="/suite/reports" />
      <StatTile label="Homework due" value={due.length} note={due.filter(h => !submitted.has(h.id)).length + ' not yet submitted'} icon={BookOpen} tone="blue" to="/suite/homework" />
      <StatTile label="Overall result" value={card.data?.maximum ? card.data.percent + '%' : '—'} note={card.data?.maximum ? 'Grade ' + card.data.grade + ' · published exams' : 'No published results yet'} icon={ClipboardList} tone="peach" to="/suite/marks" />
      <StatTile label="Documents" value={docs.length} note="Certificates issued by the school" icon={FileText} tone="purple" to="/suite/certificates" />
    </div>
    <div className="dashboard-grid"><TodayTimetable classIds={classId ? [classId] : []} link="/suite/timetable" />
      <Panel title="Homework" description="Due from today" link="/suite/homework">
        <QueryState query={homework} empty={!due.length} emptyText={['No homework due', 'New assignments for this class will appear here.']}>
          <ul className="dash-list">{due.slice(0, 5).map(h => <li key={h.id}><span className="stat-icon teal"><BookOpen size={17} /></span><div><strong>{h.title}</strong><small>{label(options.data, 'subjects', h.subjectId)} · due {String(h.dueDate).slice(0, 10)}</small></div>{submitted.has(h.id) ? <span className="status-tag active">Submitted</span> : role === 'Student' ? <Link className="button small primary" to="/suite/submissions"><Upload size={14} />Submit</Link> : <span className="tag">Not submitted</span>}</li>)}</ul>
        </QueryState>
      </Panel></div>
    <div className="dashboard-grid">
      <Panel title="Recent results" description="Published exams only" link="/suite/marks">
        <QueryState query={card} empty={!card.data?.results.length} emptyText={['No published results', 'Results appear here after the school publishes an exam.']}>
          <ul className="dash-list">{card.data?.results.slice(0, 5).map((r, i) => <li key={i}><span className="stat-icon peach"><ClipboardList size={17} /></span><div><strong>{r.exam} · {r.subject}</strong><small>{r.remarks || (r.pass ? 'Pass' : 'Below pass marks')}</small></div><span className="tag">{r.score} / {r.maximum}</span></li>)}</ul>
          <button className="button secondary" onClick={openReport}><Printer size={15} />Open report card</button>
        </QueryState>
      </Panel>
      <UpcomingExams classId={classId} link="/suite/exams" />
    </div>
    <div className="dashboard-grid">
      {role === 'Parent' ? <FeeSummary title="Fees" description="Balance for this child" link="/suite/fees" studentId={studentId} /> :
        <Panel title="Attendance this month" description={new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} link="/suite/reports">
          <QueryState query={attendance} empty={!row} emptyText={['No attendance yet', 'Marked school days appear here.']}>
            <div className="kpi-row"><div><span>Present</span><strong>{row?.present}</strong></div><div><span>Late</span><strong>{row?.late}</strong></div><div><span>Absent</span><strong>{row?.absent}</strong></div></div>
          </QueryState>
        </Panel>}
      <Panel title="Attendance days" description={new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) + ' · each marked day, with the reason the school recorded'}>
        <AttendanceDays studentId={studentId} month={month} />
      </Panel>
      <Panel title="Documents & certificates" description="Issued by the school" link="/suite/certificates">
        <QueryState query={certificates} empty={!docs.length} emptyText={['No documents yet', 'Certificates issued by the school will appear here.']}>
          <ul className="dash-list">{docs.slice(0, 4).map(d => <li key={d.id}><span className="stat-icon purple">{d.type === 'Student ID' ? <GraduationCap size={17} /> : <FileText size={17} />}</span><div><strong>{d.type}</strong><small>{d.certificateNumber} · {String(d.issuedOn).slice(0, 10)}</small></div><button className="button small secondary" onClick={() => printCertificate(d.id)}><Printer size={14} />Print</button></li>)}</ul>
        </QueryState>
      </Panel>
    </div>
    <div className="dashboard-grid lower-grid"><RecentCirculars link="/suite/circulars" canAcknowledge /></div>
  </>
}
