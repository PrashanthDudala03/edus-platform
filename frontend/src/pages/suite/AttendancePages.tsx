import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ClipboardCheck, History, Search } from 'lucide-react'
import client, { errorMessage } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { Dialog, Empty, ErrorBox, Loading, PageHeader, today } from '../../components/UI'
import { data } from './helpers'
import { isLeadership } from '../../roles'
import { STATUSES, SHORT, changes, classesOf, filterRows, isCorrection, markRestPresent, mayHaveReason, percent, stateTone, submittedClasses, summary, type ClassRegister, type DayRecord, type Mark, type RegisterRow, type Status } from './attendance'

// The daily register as a workflow: pick the day and class, mark everyone with one tap each (or the rest present at
// once), give a reason where it helps, submit, and see the class marked as done. After submission a change is a
// correction: the server requires a reason and keeps the history. Leadership sees every class and its state.
type Registers = { day: string, totals: { expected: number, marked: number, present: number, absent: number, late: number, excused: number, completed: number, pending: number, percent: number }, classes: ClassRegister[], reasons: string[] }
export const useRegisters = (day: string, enabled = true) => useQuery<Registers>({ queryKey: ['suite', 'registers', day], enabled, queryFn: () => data('/student-attendance/registers', { day }) })

export function RegisterPage() {
  const cache = useQueryClient(), leader = isLeadership(useAuthStore(s => s.user?.roles[0])), can = useAuthStore(s => s.user?.permissions.includes('attendance.mark') ?? false)
  const [day, setDay] = useState(today()), [cls, setCls] = useState(''), [search, setSearch] = useState(''), [draft, setDraft] = useState<Record<string, Mark>>({})
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [confirm, setConfirm] = useState<'submit' | 'correct' | null>(null), [reason, setReason] = useState(''), [remark, setRemark] = useState('')
  const [history, setHistory] = useState(false)
  const list = useQuery<RegisterRow[]>({ queryKey: ['suite', 'register', day], queryFn: () => data('/student-attendance', { day }) })
  const registers = useRegisters(day)
  const rows = list.data ?? [], classes = classesOf(rows), active = classes.includes(cls) ? cls : '', shown = filterRows(rows, active, search)
  const counts = summary(shown, draft), pending = changes(rows, draft), dirty = pending.length > 0
  const submitted = submittedClasses(registers.data?.classes ?? []), correcting = isCorrection(rows, draft, submitted)
  const activeRegister = registers.data?.classes.find(r => r.className === active)
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn) }, [dirty])
  const set = (id: string, mark: Mark) => { setMessage(''); setDraft(current => ({ ...current, [id]: { ...current[id], ...mark } })) }
  const pick = (next: string) => { if (dirty && !window.confirm('Discard unsaved attendance?')) return; setDay(next); setDraft({}); setMessage(''); setError('') }
  async function send(submit: boolean) {
    setBusy(true); setError(''); setMessage('')
    try {
      const r = await client.post('/suite/student-attendance', { day, entries: pending, submit, ...(correcting ? { reason, remark } : {}) })
      setDraft({}); setConfirm(null); setReason(''); setRemark(''); setMessage(r.data.message)
      await Promise.all([cache.invalidateQueries({ queryKey: ['suite', 'register', day] }), cache.invalidateQueries({ queryKey: ['suite', 'registers', day] }), cache.invalidateQueries({ queryKey: ['overview'] }), cache.invalidateQueries({ queryKey: ['suite', 'reports'] })])
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  const ready = active ? counts.unmarked === 0 : false, done = activeRegister?.state === 'Submitted' || activeRegister?.state === 'Corrected'
  const primary = correcting ? <button className="button primary" disabled={!dirty || busy} onClick={() => setConfirm('correct')}><Check size={16} />Record correction</button>
    : <button className="button primary" disabled={busy || (!dirty && (done || !ready))} onClick={() => dirty || !ready ? (ready && active ? setConfirm('submit') : send(false)) : setConfirm('submit')}><ClipboardCheck size={16} />{ready && active && !done ? 'Submit register' : 'Save changes'}</button>
  return <><PageHeader eyebrow="DAILY ATTENDANCE" title="Student register" description={leader ? 'Every class in the school. Submitted registers are corrected with a reason, and every change is kept.' : 'Students in your assigned classes. Mark everyone, then submit the register for the class.'}>
    {can && primary}</PageHeader>
    {error && <ErrorBox message={error} />} {message && <div className="success-box" role="status">{message}</div>}
    {leader && <RegistersPanel day={day} onOpen={name => setCls(name)} />}
    <section className="panel register-panel"><div className="attendance-toolbar">
      <label>Date<input type="date" value={day} max={today()} onChange={e => pick(e.target.value)} /></label>
      {classes.length > 1 && <label>Class<select value={active} onChange={e => setCls(e.target.value)}><option value="">All classes</option>{classes.map(c => <option key={c} value={c}>{c}</option>)}</select></label>}
      <label>Find<span className="search-field"><Search size={16} /><input type="search" value={search} placeholder="Name or admission number" onChange={e => setSearch(e.target.value)} /></span></label>
      <div className="attendance-toolbar-actions">{can && counts.unmarked > 0 && <button className="button secondary" disabled={busy} onClick={() => setDraft(markRestPresent(shown, draft))}>Mark the rest present</button>}{leader && <button className="button secondary" onClick={() => setHistory(true)}><History size={16} />Changes</button>}<Link className="button secondary" to="/suite/reports">Monthly reports</Link></div>
    </div>
    {!!rows.length && <div className="register-summary" role="status">{activeRegister && <span className={'status-tag ' + stateTone(activeRegister.state)}>{activeRegister.state}</span>}<span>{counts.Present} present</span><span>{counts.Late} late</span><span>{counts.Absent} absent</span><span>{counts.Excused} excused</span><span>{counts.unmarked} not marked</span>{dirty && <strong>{pending.length} unsaved</strong>}</div>}
    {list.isPending ? <Loading /> : list.isError ? <ErrorBox message={errorMessage(list.error)} /> : !rows.length ? <Empty title="No assigned students" description="Allocate students to classes and link the teacher account to its staff profile." /> : !shown.length ? <Empty title="No students match" description="Try another name or class." /> : <div className="table-scroll"><table><thead><tr><th>Student</th><th>Admission number</th><th>Class</th><th>Status</th><th>Reason</th></tr></thead><tbody>{shown.map(s => {
      const status = draft[s.id]?.status ?? s.status, reasonValue = draft[s.id]?.reason ?? s.reason ?? '', remarkValue = draft[s.id]?.remark ?? s.remark ?? ''
      return <tr key={s.id}><td>{s.name}</td><td>{s.code}</td><td>{s.class}</td>
        <td>{can ? <div className="mark-group" role="radiogroup" aria-label={'Attendance for ' + s.name}>{STATUSES.map(v => <button key={v} type="button" role="radio" aria-checked={status === v} aria-label={s.name + ': ' + v} title={v} className={'mark mark-' + v.toLowerCase() + (status === v ? ' on' : '')} onClick={() => set(s.id, { status: v })}>{SHORT[v]}</button>)}</div> : <span className="status-tag">{status ?? 'Not marked'}</span>}</td>
        <td>{status && mayHaveReason(status) ? <div className="reason-cell"><select aria-label={'Reason for ' + s.name} value={reasonValue} disabled={!can} onChange={e => set(s.id, { status, reason: e.target.value })}><option value="">No reason</option>{(registers.data?.reasons ?? []).map(r => <option key={r}>{r}</option>)}</select>{(reasonValue === 'Other' || remarkValue) && <input aria-label={'Remark for ' + s.name} value={remarkValue} maxLength={200} placeholder="What happened" disabled={!can} onChange={e => set(s.id, { status, remark: e.target.value })} />}</div> : <span className="muted">—</span>}</td></tr>
    })}</tbody></table></div>}</section>
    {confirm && <Dialog title={confirm === 'correct' ? 'Record a correction' : 'Submit the register'} onClose={() => !busy && setConfirm(null)}>
      {confirm === 'correct' ? <><p>This register was already submitted. The change is kept with the original, and the reason is recorded against your account.</p>
        <label>Reason<select value={reason} onChange={e => setReason(e.target.value)}><option value="">Choose a reason</option>{(registers.data?.reasons ?? []).map(r => <option key={r}>{r}</option>)}</select></label>
        <label>Remark{reason === 'Other' ? '' : ' (optional)'}<input value={remark} maxLength={200} onChange={e => setRemark(e.target.value)} /></label></>
        : <p>{pending.length ? pending.length + ' change' + (pending.length === 1 ? '' : 's') + ' will be saved and the register for ' + (active || 'the marked classes') + ' marked as submitted.' : 'Mark the register for ' + active + ' as submitted. The school office will see it as complete.'}</p>}
      <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button><button type="button" className="button primary" disabled={busy || (confirm === 'correct' && !reason && !remark)} onClick={() => send(confirm === 'submit')}>{busy ? 'Saving…' : confirm === 'correct' ? 'Record correction' : 'Submit'}</button></div></Dialog>}
    {history && <HistoryDialog day={day} onClose={() => setHistory(false)} />}</>
}

/** Which classes have completed today's register, for leadership. The same figures feed the dashboards. */
export function RegistersPanel({ day, onOpen, compact }: { day: string, onOpen?: (className: string) => void, compact?: boolean }) {
  const registers = useRegisters(day), t = registers.data?.totals
  return <section className="panel registers-panel" aria-label="Attendance registers"><div className="panel-heading"><div><h2>{day === today() ? "Today's attendance registers" : 'Attendance registers'}</h2><p>{t ? `${t.completed} submitted · ${t.pending} pending · ${t.marked} of ${t.expected} students marked` : 'Which classes have completed the register'}</p></div>{compact && <Link className="text-link" to="/suite/register">Open register</Link>}</div>
    {registers.isPending ? <Loading /> : registers.isError ? <ErrorBox message={errorMessage(registers.error)} /> : !registers.data!.classes.length ? <Empty title="No classes yet" description="Registers appear once students are allocated to classes." /> : <>
      {t && <div className="kpi-row"><div><span>Attendance</span><strong>{t.marked ? t.percent + '%' : '—'}</strong></div><div><span>Present</span><strong>{t.present}</strong></div><div><span>Late</span><strong>{t.late}</strong></div><div><span>Absent</span><strong>{t.absent}</strong></div></div>}
      <ul className="dash-list registers-list">{registers.data!.classes.slice(0, compact ? 8 : 100).map(r => <li key={r.className}><div><strong>{r.className}</strong><small>{r.teacher ? r.teacher + ' · ' : ''}{r.marked} of {r.expected} marked{r.absent ? ' · ' + r.absent + ' absent' : ''}{r.late ? ' · ' + r.late + ' late' : ''}</small></div><span className={'status-tag ' + stateTone(r.state)}>{r.state}</span>{onOpen && <button type="button" className="button small secondary" onClick={() => onOpen(r.className)}>Open</button>}</li>)}</ul></>}</section>
}

function HistoryDialog({ day, onClose }: { day: string, onClose: () => void }) {
  const rows = useQuery<{ student: string, kind: string, oldStatus: string | null, newStatus: string, reason: string | null, remark: string | null, changedAt: string, changedBy: string }[]>({ queryKey: ['suite', 'attendance-history', day], queryFn: () => data('/student-attendance/history', { day }) })
  return <Dialog title={'Attendance changes on ' + day} onClose={onClose}>{rows.isPending ? <Loading /> : rows.isError ? <ErrorBox message={errorMessage(rows.error)} /> : !rows.data.length ? <Empty title="No changes recorded" description="Submissions and corrections appear here." /> : <div className="table-scroll"><table><thead><tr><th>Student</th><th>Change</th><th>Reason</th><th>By</th><th>When</th></tr></thead><tbody>{rows.data.map((r, i) => <tr key={i}><td>{r.student}</td><td>{r.kind === 'correction' ? (r.oldStatus ?? '—') + ' → ' + r.newStatus : r.newStatus}</td><td>{[r.reason, r.remark].filter(Boolean).join(': ') || '—'}</td><td>{r.changedBy}</td><td>{new Date(r.changedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td></tr>)}</tbody></table></div>}</Dialog>
}

/** A student's days in a month, for families and for the student. Reasons are shown because the school recorded them for this family. */
export function AttendanceDays({ studentId, month }: { studentId: string, month: string }) {
  const days = useQuery<{ days: DayRecord[], present: number, late: number, absent: number, excused: number, markedDays: number, percent: number }>({ queryKey: ['suite', 'reports', 'attendance-days', studentId, month], queryFn: () => data('/reports/attendance/days', { studentId, month }) })
  if (days.isPending) return <Loading />
  if (days.isError) return <ErrorBox message={errorMessage(days.error)} />
  const d = days.data
  if (!d.markedDays) return <Empty title="No attendance yet" description="Marked school days appear here." />
  return <><div className="kpi-row"><div><span>Attended</span><strong>{percent(d.present + d.late, d.markedDays)}%</strong></div><div><span>Present</span><strong>{d.present}</strong></div><div><span>Late</span><strong>{d.late}</strong></div><div><span>Absent</span><strong>{d.absent}</strong></div></div>
    <ul className="dash-list day-list">{d.days.map(x => <li key={x.day}><div><strong>{new Date(x.day + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</strong>{(x.reason || x.remark) && <small>{[x.reason, x.remark].filter(Boolean).join(': ')}</small>}</div><span className={'status-tag ' + (x.status === 'Present' ? 'active' : x.status === 'Absent' ? '' : 'important')}>{x.status}</span></li>)}</ul></>
}

/** Month by class for leadership and teachers: percentage and how many students are under the threshold. */
export function ClassAttendanceReport({ month }: { month: string }) {
  const rows = useQuery<{ threshold: number, classes: { className: string, students: number, present: number, late: number, absent: number, excused: number, marked: number, percent: number, low: number }[] }>({ queryKey: ['suite', 'reports', 'attendance-classes', month], queryFn: () => data('/reports/attendance/classes', { month }) })
  if (rows.isPending) return <Loading />
  if (rows.isError) return <ErrorBox message={errorMessage(rows.error)} />
  if (!rows.data.classes.some(c => c.marked)) return <Empty title="No attendance for this month" description="Marked days appear here once registers are saved." />
  return <div className="table-scroll"><table><thead><tr><th>Class</th><th>Students</th><th>Attendance</th><th>Present</th><th>Late</th><th>Absent</th><th>Excused</th><th>Below {rows.data.threshold}%</th></tr></thead><tbody>{rows.data.classes.map(c => <tr key={c.className}><td>{c.className}</td><td>{c.students}</td><td>{c.marked ? c.percent + '%' : '—'}</td><td>{c.present}</td><td>{c.late}</td><td>{c.absent}</td><td>{c.excused}</td><td>{c.low ? <span className="status-tag important">{c.low} student{c.low === 1 ? '' : 's'}</span> : '—'}</td></tr>)}</tbody></table></div>
}
