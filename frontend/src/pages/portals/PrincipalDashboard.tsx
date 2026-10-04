import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { GraduationCap, BookOpen, Layers, CalendarCheck, Users, ClipboardList, ArrowUpRight } from 'lucide-react'
import client, { errorMessage } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { OperationsPanel } from '../suite/TimetablePage'
import { ErrorBox, PageHeader, today } from '../../components/UI'
import { data, type Row } from '../suite/helpers'
import { FeeSummary, Panel, QueryState, RecentCirculars, StatTile, UpcomingExams, useRecords } from './widgets'
import { RegistersPanel } from '../suite/AttendancePages'
import { useOverview } from '../suite/HomeworkPage'
import { overviewTotals } from '../suite/homework'
type Overview = { stats: { students: number, teachers: number, parents: number, classes: number, present: number, marked: number } }

// Academic and operational head of one school: reads everything, changes academic oversight records only.
export default function PrincipalDashboard() {
  const user = useAuthStore(s => s.user)
  const overview = useQuery<Overview>({ queryKey: ['overview', today()], queryFn: async () => (await client.get('/operations/overview', { params: { day: today() } })).data.data })
  const staff = useRecords('staff-attendance', today()), leave = useRecords('leave-requests', 'Pending'), admissions = useRecords('admissions', 'Submitted')
  const exams = useRecords('exams'), marks = useQuery<Row[]>({ queryKey: ['suite', 'reports', 'marks'], queryFn: () => data('/reports/marks') })
  const s = overview.data?.stats
  const staffToday = (staff.data?.data || []).filter(r => r.day === today())
  const staffPresent = staffToday.filter(r => r.status === 'Present' || r.status === 'Late').length
  const pendingLeave = (leave.data?.data || []).filter(r => r.status === 'Pending').length
  const pendingAdmissions = (admissions.data?.data || []).filter(r => r.status === 'Submitted').length
  // Performance only from published exams that have saved marks.
  const published = new Map((exams.data?.data || []).filter(e => e.status === 'Published').map(e => [e.id, e]))
  const perExam = [...published.values()].map(exam => {
    const scores = (marks.data || []).filter(m => m.examId === exam.id).map(m => Number(m.score) / Number(exam.maxMarks) * 100)
    return { exam, count: scores.length, average: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0, passed: (marks.data || []).filter(m => m.examId === exam.id && Number(m.score) >= Number(exam.passMarks)).length }
  }).filter(r => r.count > 0)
  const work = useOverview(), workTotals = overviewTotals(work.data?.items ?? [])
  const hour = new Date().getHours(), greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  return <><PageHeader eyebrow="PRINCIPAL PORTAL" title={greeting + ', ' + (user?.firstName || 'Principal') + '.'} description="Academic and operational oversight for your school. Finance and account administration stay with the school administrator." />
    {overview.isError ? <ErrorBox message={errorMessage(overview.error)} /> : <div className="stats-grid">
      <StatTile label="Total students" value={s ? Number(s.students).toLocaleString() : '—'} note="Active student records" icon={GraduationCap} tone="teal" to="/students" />
      <StatTile label="Teaching staff" value={s ? Number(s.teachers).toLocaleString() : '—'} note="Teacher profiles" icon={BookOpen} tone="blue" to="/teachers" />
      <StatTile label="Today's attendance" value={s?.marked ? Math.round(Number(s.present) / Number(s.marked) * 100) + '%' : '—'} note={s ? s.present + ' present of ' + s.marked + ' marked' : 'Loading'} icon={CalendarCheck} tone="peach" to="/suite/register" />
      <StatTile label="Class groups" value={s ? Number(s.classes).toLocaleString() : '—'} note="From current enrolments" icon={Layers} tone="purple" to="/suite/classes" />
    </div>}
    <div className="dashboard-grid">
      <RegistersPanel day={today()} compact />
      <Panel title="Staff attendance today" description={new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })} link="/suite/staff-attendance">
        <QueryState query={staff} empty={!staffToday.length} emptyText={['Not recorded yet', 'Staff attendance entered for today will appear here.']}>
          <div className="kpi-row"><div><span>Present or late</span><strong>{staffPresent}</strong></div><div><span>Absent or excused</span><strong>{staffToday.length - staffPresent}</strong></div><div><span>Recorded</span><strong>{staffToday.length}</strong></div></div>
        </QueryState>
      </Panel>
      {user?.permissions.includes("substitutions.view") && <Panel title="Cover for today" description="Teachers away and the lessons that need someone" link="/suite/timetable?tab=today" linkLabel="Assign cover"><OperationsPanel date={today()} canCover={false} compact /></Panel>}
      <Panel title="Needs your attention" description="Pending school activity">
        <ul className="dash-list">
          <li><span className="stat-icon blue"><BookOpen size={17} /></span><div><strong>{work.isPending ? '…' : workTotals.published} published assignment{workTotals.published === 1 ? '' : 's'}</strong><small>{work.isPending ? '' : workTotals.missing + ' missing · ' + workTotals.toReview + ' to review'}</small></div><Link className="text-link" to="/suite/homework">Open <ArrowUpRight size={14} /></Link></li>
          <li><span className="stat-icon peach"><Users size={17} /></span><div><strong>{leave.isPending ? '…' : pendingLeave} leave request{pendingLeave === 1 ? '' : 's'} awaiting approval</strong><small>Approve or reject staff leave</small></div><Link className="text-link" to="/suite/leave-requests">Review <ArrowUpRight size={14} /></Link></li>
          <li><span className="stat-icon teal"><GraduationCap size={17} /></span><div><strong>{admissions.isPending ? '…' : pendingAdmissions} submitted admission{pendingAdmissions === 1 ? '' : 's'}</strong><small>Accepted by the school administrator</small></div></li>
        </ul>
      </Panel>
    </div>
    <div className="dashboard-grid">
      <Panel title="Academic performance" description="Average score in published exams" link="/suite/reports" linkLabel="Reports">
        <QueryState query={marks} empty={!perExam.length} emptyText={['No published results yet', 'Averages appear once exams with saved marks are published.']}>
          <div className="class-bars">{perExam.slice(0, 6).map(r => <div key={r.exam.id}><span>{r.exam.name}</span><div><i style={{ width: Math.min(100, r.average) + '%' }} /></div><strong>{Math.round(r.average)}%</strong></div>)}</div>
          <p className="muted"><ClipboardList size={14} /> {perExam.reduce((a, r) => a + r.passed, 0)} of {perExam.reduce((a, r) => a + r.count, 0)} results at or above pass marks</p>
        </QueryState>
      </Panel>
      <UpcomingExams link="/suite/exams" />
    </div>
    <div className="dashboard-grid lower-grid"><FeeSummary title="Fees overview" description="Read-only summary of the school ledger" link="/suite/fees" readOnly /><RecentCirculars link="/suite/circulars" /></div></>
}
