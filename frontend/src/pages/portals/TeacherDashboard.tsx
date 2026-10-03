import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, CalendarCheck, ClipboardList, GraduationCap, ArrowUpRight } from 'lucide-react'
import { useAuthStore } from '../../store/auth'
import { PageHeader, today } from '../../components/UI'
import { data, label, type Row } from '../suite/helpers'
import { Panel, QueryState, RecentCirculars, StatTile, TodayTimetable, UpcomingExams, useOptions, useRecords } from './widgets'
import { useOverview } from '../suite/HomeworkPage'
import { overviewTotals } from '../suite/homework'

// A teacher sees only the classes linked to their staff profile; the API applies that scope to every list below.
export default function TeacherDashboard() {
  const user = useAuthStore(s => s.user)
  const classes = useRecords('classes'), assignments = useRecords('teaching-assignments'), homework = useRecords('homework'), submissions = useRecords('submissions'), options = useOptions()
  const register = useQuery<Row[]>({ queryKey: ['suite', 'register', today()], queryFn: () => data('/student-attendance', { day: today() }) })
  const classIds = [...new Set([...(classes.data?.data || []).map(c => c.id), ...(assignments.data?.data || []).map(a => a.classId)])]
  const subjects = [...new Set((assignments.data?.data || []).map(a => label(options.data, 'subjects', a.subjectId)))]
  const students = register.data || [], marked = students.filter(s => s.status).length
  const upcomingHomework = (homework.data?.data || []).filter(h => String(h.dueDate) >= today()).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))).slice(0, 5)
  const awaiting = (submissions.data?.data || []).filter(s => !s.feedback), work = useOverview(), workTotals = overviewTotals(work.data?.items ?? [])
  const linked = !classes.isPending && !assignments.isPending && classIds.length > 0
  return <><PageHeader eyebrow="TEACHER PORTAL" title={'Welcome, ' + (user?.firstName || 'Teacher') + '.'} description="Your classes, lessons and marking for today."><Link className="button primary" to="/suite/register"><CalendarCheck size={17} />Take attendance</Link></PageHeader>
    {!classes.isPending && !assignments.isPending && !linked && <div className="info-box">No classes are assigned to your account yet. Ask the school administrator to link your account to your staff profile and add your teaching assignments.</div>}
    <div className="stats-grid">
      <StatTile label="My classes" value={classIds.length} note={classIds.map(id => label(options.data, 'classes', id)).join(', ') || 'None assigned'} icon={BookOpen} tone="teal" to="/suite/classes" />
      <StatTile label="My subjects" value={subjects.length} note={subjects.join(', ') || 'None assigned'} icon={ClipboardList} tone="blue" to="/suite/teaching-assignments" />
      <StatTile label="Attendance today" value={students.length ? marked + ' / ' + students.length : '—'} note="Students marked in your classes" icon={CalendarCheck} tone="peach" to="/suite/register" />
      <StatTile label="To review" value={work.data ? workTotals.toReview : awaiting.length} note={work.data ? workTotals.missing + ' missing · ' + workTotals.late + ' handed in late' : 'Submissions without feedback'} icon={GraduationCap} tone="purple" to="/suite/homework" />
    </div>
    <div className="dashboard-grid"><TodayTimetable classIds={classIds} link="/suite/timetable" />
      <Panel title="Homework due" description="Assignments for your classes" link="/suite/homework">
        <QueryState query={homework} empty={!upcomingHomework.length} emptyText={['No homework due', 'Create homework for your assigned classes.']}>
          <ul className="dash-list">{upcomingHomework.map(h => <li key={h.id}><span className="stat-icon teal"><BookOpen size={17} /></span><div><strong>{h.title}</strong><small>{label(options.data, 'classes', h.classId)} · {label(options.data, 'subjects', h.subjectId)}</small></div><span className="tag">Due {String(h.dueDate).slice(0, 10)}</span></li>)}</ul>
        </QueryState>
      </Panel></div>
    <div className="dashboard-grid">
      <Panel title="Submissions to review" description="Add feedback and grades" link="/suite/submissions">
        <QueryState query={submissions} empty={!awaiting.length} emptyText={['All caught up', 'New student submissions will appear here.']}>
          <ul className="dash-list">{awaiting.slice(0, 5).map(s => <li key={s.id}><span className="stat-icon purple"><GraduationCap size={17} /></span><div><strong>{label(options.data, 'students', s.studentId)}</strong><small>{label(options.data, 'homework', s.homeworkId)}</small></div><Link className="text-link" to="/suite/submissions">Review <ArrowUpRight size={14} /></Link></li>)}</ul>
        </QueryState>
      </Panel>
      <UpcomingExams link="/suite/marks" title="Upcoming exams & marking" />
    </div>
    <div className="dashboard-grid lower-grid"><RecentCirculars link="/suite/circulars" canAcknowledge /></div></>
}
