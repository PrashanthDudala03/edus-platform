import { FormEvent, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Archive, Copy, UserCheck, CalendarCheck } from 'lucide-react'
import client, { errorMessage } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { Dialog, Empty, ErrorBox, Loading, PageHeader } from '../../components/UI'
import { data, type Module, type Options } from './helpers'
import { SuiteInput } from './SuitePage'
import { isLeadership } from '../../roles'
import { type Week, type Day, type Operations, type Candidate, type Period, type GridRow, DAYS, gridRows, daysShown, position, nowMinutes, isoDate, shiftDate, span, teacherShown, statusWord, statusTone, dayName } from './timetable'

// Timetable 2.0: the office reads and edits the week by class, teacher or room and covers absent teachers day by day;
// a teacher sees their own day and week with the periods they cover; a family sees the class's effective schedule.
// Every figure comes from the timetable endpoints, which apply the role's scope; nothing is computed from other records.
export default function TimetablePage() {
  const user = useAuthStore(s => s.user), role = user?.roles?.[0] || ''
  if (isLeadership(role)) return <OfficeTimetable canManage={!!user?.permissions.includes('timetable.manage')} canCover={!!user?.permissions.includes('substitutions.manage')} canOperate={!!user?.permissions.includes('substitutions.view')} />
  if (role === 'Teacher') return <TeacherTimetable />
  return <FamilyTimetable role={role} />
}

const useOptions = () => useQuery<Options>({ queryKey: ['suite', 'options'], queryFn: () => data('/options') })
const useWeek = (params: Record<string, string | undefined>, enabled = true) => useQuery<Week>({ queryKey: ['suite', 'timetable', 'week', params], queryFn: () => data('/timetable/week', params), enabled })
const useDay = (params: Record<string, string | undefined>, enabled = true) => useQuery<Day>({ queryKey: ['suite', 'timetable', 'today', params], queryFn: () => data('/timetable/today', params), enabled })
const Tabs = ({ tabs, active, pick }: { tabs: [string, string][], active: string, pick: (t: string) => void }) => <div className="module-tabs" role="tablist">{tabs.map(([key, label]) => <a key={key} href="#" role="tab" aria-selected={active === key} className={active === key ? 'selected' : ''} onClick={e => { e.preventDefault(); pick(key) }}>{label}</a>)}</div>
const DateNav = ({ date, set, label = 'Date' }: { date: string, set: (d: string) => void, label?: string }) => <div className="row-actions tt-datenav"><button className="button small secondary" aria-label="Previous day" onClick={() => set(shiftDate(date, -1))}>‹</button><label className="tt-date">{label}<input type="date" value={date} onChange={e => e.target.value && set(e.target.value)} /></label><button className="button small secondary" aria-label="Next day" onClick={() => set(shiftDate(date, 1))}>›</button><button className="button small secondary" onClick={() => set(isoDate())}>Today</button></div>

function useTab(fallback: string) { const [params, setParams] = useSearchParams(); return [params.get('tab') || fallback, (t: string) => setParams(p => { p.set('tab', t); return p }, { replace: true })] as const }

/** The week as a grid: the school's periods down the side, days across; each cell holds what that period is for the chosen class, teacher or room. */
export function WeekGrid({ week, mode, onEdit, onArchive }: { week: Week, mode: 'class' | 'teacher' | 'room' | 'family', onEdit?: (p: Period) => void, onArchive?: (p: Period) => void }) {
  const rows = gridRows(week.slots, week.periods), days = daysShown(rows)
  if (!rows.length) return <Empty title="Nothing on the timetable" description={mode === 'family' ? 'The class timetable will appear here once the school publishes it.' : 'Add the school’s period structure, then place lessons in it.'} />
  const cell = (p: Period) => <div key={p.id} className={'tt-lesson' + (p.substituted ? ' substituted' : '')}>
    <strong>{mode === 'class' || mode === 'family' ? p.subjectName : p.className}</strong>
    <small>{mode === 'class' || mode === 'family' ? teacherShown(p) : mode === 'teacher' ? p.subjectName : p.subjectName + ' · ' + teacherShown(p)}{p.room && mode !== 'room' ? ' · ' + p.room : ''}{p.substituted ? ' (substitute)' : ''}</small>
    {(onEdit || onArchive) && <span className="row-actions">{onEdit && <button className="icon-button" aria-label={'Edit ' + p.subjectName + ' ' + p.day + ' ' + p.startsAt} onClick={() => onEdit(p)}><Pencil size={14} /></button>}{onArchive && <button className="icon-button" aria-label={'Remove ' + p.subjectName + ' ' + p.day + ' ' + p.startsAt} onClick={() => onArchive(p)}><Archive size={14} /></button>}</span>}
  </div>
  return <div className="table-scroll tt-scroll"><table className="tt-grid"><thead><tr><th scope="col">Period</th>{days.map(d => <th key={d} scope="col">{d}<small>{week.days.find(x => x.day === d)?.date.slice(5)}</small></th>)}</tr></thead>
    <tbody>{rows.map(r => <tr key={r.key} className={r.type !== 'Teaching' ? 'tt-break' : ''}><th scope="row">{r.name || 'Lesson'}<small>{span(r)}</small>{r.type !== 'Teaching' && <small className="tag">{r.type}</small>}</th>{days.map(d => <td key={d}>{r.type !== 'Teaching' ? <span className="muted">{r.type}</span> : (r.cells[d] ?? []).map(cell)}{r.type === 'Teaching' && !r.cells[d]?.length && <span className="muted tt-free">Free</span>}</td>)}</tr>)}</tbody></table></div>
}

/** One day as a list: each period with the person taking it and, for the office and the teacher, its cover state. */
function DayList({ rows, dayKey, now, office }: { rows: GridRow[], dayKey: string, now?: number, office: boolean }) {
  const lessons = rows.filter(r => r.type !== 'Teaching' || r.cells[dayKey]?.length), pos = now == null ? { current: -1, next: -1 } : position(lessons, now)
  if (!lessons.some(r => r.type === 'Teaching')) return <Empty title="No periods today" description="Nothing is on the timetable for this day." />
  return <ul className="dash-list tt-day">{lessons.map((r, i) => <li key={r.key} className={i === pos.current ? 'tt-now' : i === pos.next ? 'tt-next' : ''}>
    <span className="stat-icon teal"><CalendarCheck size={17} /></span>
    <div><strong>{span(r)}{r.name ? ' · ' + r.name : ''}{i === pos.current ? <span className="tag">Now</span> : i === pos.next ? <span className="tag">Next</span> : null}</strong>
      {r.type !== 'Teaching' ? <small>{r.type}</small> : (r.cells[dayKey] ?? []).map(p => <small key={p.id} className="tt-line">{p.subjectName} · {p.className} · {teacherShown(p)}{p.room ? ' · ' + p.room : ''}{p.substituted && !office ? ' (substitute)' : ''}{office && statusWord(p) ? <span className={'status-tag ' + statusTone(p)}>{statusWord(p)}</span> : null}</small>)}
    </div></li>)}</ul>
}

function PeriodForm({ module, options, edit, onClose, onSaved }: { module: Module, options?: Options, edit: Period | null, onClose: () => void, onSaved: (m: string) => void }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError('')
    const values = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    try { if (edit) await client.put('/suite/records/timetable/' + edit.id, { ...values, version: edit.version }); else await client.post('/suite/records/timetable', values); onSaved(edit ? 'Period updated.' : 'Period added.') } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return <Dialog title={edit ? 'Edit period' : 'Add period'} onClose={() => !busy && onClose()}><form onSubmit={save}>{error && <ErrorBox message={error} />}
    <div className="form-grid">{module.fields.map(f => <SuiteInput key={f.key} field={f} options={options} value={edit ? (edit as Record<string, unknown>)[f.key] : undefined} />)}</div>
    <p className="muted">Choose a period from the school’s structure, or enter times. The server refuses a teacher, class or room that is already taken at that time.</p>
    <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save period'}</button></div></form></Dialog>
}

function CoverDialog({ period, date, onClose, onSaved }: { period: Period, date: string, onClose: () => void, onSaved: (m: string) => void }) {
  const candidates = useQuery<{ period: Period, candidates: Candidate[] }>({ queryKey: ['suite', 'timetable', 'candidates', period.id, date], queryFn: () => data('/timetable/candidates', { timetableId: period.id, date }) })
  const [teacherId, setTeacherId] = useState(period.substitution?.teacherId ?? ''), [note, setNote] = useState(period.substitution?.note ?? ''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function save(e: FormEvent) {
    e.preventDefault(); if (!teacherId) { setError('Choose a teacher.'); return } setBusy(true); setError('')
    try {
      if (period.substitution) await client.put('/suite/records/substitutions/' + period.substitution.id, { date, timetableId: period.id, teacherId, note, version: period.substitution.version })
      else await client.post('/suite/records/substitutions', { date, timetableId: period.id, teacherId, note })
      onSaved('Substitute assigned.')
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return <Dialog title={(period.substitution ? 'Change cover for ' : 'Cover ') + period.className + ' · ' + period.subjectName} onClose={() => !busy && onClose()}><form onSubmit={save}>{error && <ErrorBox message={error} />}
    <p className="muted">{date} · {span(period)}{period.room ? ' · ' + period.room : ''} · usually {period.teacherName}</p>
    {candidates.isPending ? <Loading /> : candidates.isError ? <ErrorBox message={errorMessage(candidates.error)} /> : <div className="tt-candidates" role="radiogroup" aria-label="Available teachers">{candidates.data.candidates.map(c => <label key={c.teacherId} className={'tt-candidate' + (c.free ? '' : ' busy')}><input type="radio" name="teacher" value={c.teacherId} disabled={!c.free} checked={teacherId === c.teacherId} onChange={() => setTeacherId(c.teacherId)} /><span><strong>{c.name}</strong><small>{c.free ? (c.teachesSubject ? 'Teaches this subject' : c.teachesClass ? 'Teaches this class' : 'Free') + ' · ' + c.load + ' period' + (c.load === 1 ? '' : 's') + ' that day' : c.reason}</small></span></label>)}</div>}
    <label className="full-width">Note for the substitute (optional)<input value={note} maxLength={255} onChange={e => setNote(e.target.value)} /></label>
    <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || !teacherId}>{busy ? 'Saving…' : 'Assign substitute'}</button></div></form></Dialog>
}

/** The office's day: who is away, which lessons that touches, and one click to cover each. */
export function OperationsPanel({ date, canCover, compact }: { date: string, canCover: boolean, compact?: boolean }) {
  const cache = useQueryClient(), ops = useQuery<Operations>({ queryKey: ['suite', 'timetable', 'operations', date], queryFn: () => data('/timetable/operations', { date }) })
  const [cover, setCover] = useState<Period | null>(null), [message, setMessage] = useState('')
  if (ops.isPending) return <Loading />
  if (ops.isError) return <ErrorBox message={errorMessage(ops.error)} />
  const o = ops.data
  return <>
    {message && <div className="success-box" role="status">{message}</div>}
    <div className="kpi-row tt-kpis"><div><span>Teachers away</span><strong>{o.summary.away}</strong></div><div><span>Lessons affected</span><strong>{o.summary.affected}</strong></div><div><span>Covered</span><strong>{o.summary.covered}</strong></div><div><span>Need cover</span><strong className={o.summary.uncovered ? 'text-warn' : ''}>{o.summary.uncovered}</strong></div></div>
    {!compact && <>{o.away.length ? <p className="muted">Away on {o.day}: {o.away.map(a => a.teacherName + (a.type ? ' (' + a.type + (a.halfDay && a.halfDay !== 'No' ? ', ' + a.halfDay.toLowerCase() : '') + ')' : '')).join(', ')}.</p> : <p className="muted">Nobody is on approved leave or marked absent on {o.day}.</p>}</>}
    {o.periods.length ? <div className="table-scroll"><table className="tt-ops"><thead><tr><th>Time</th><th>Class</th><th>Subject</th><th>Usual teacher</th><th>Cover</th>{canCover && <th>Action</th>}</tr></thead><tbody>{o.periods.map(p => <tr key={p.id} className={p.status === 'uncovered' ? 'tt-uncovered' : ''}>
      <td>{span(p)}{p.room ? <small> · {p.room}</small> : null}</td><td>{p.className}</td><td>{p.subjectName}</td><td>{p.teacherName}</td>
      <td><span className={'status-tag ' + statusTone(p)}>{p.status === 'covered' ? p.substitution?.teacherName : 'Needs cover'}</span>{p.substitution?.note ? <small className="muted"> · {p.substitution.note}</small> : null}</td>
      {canCover && <td><button className={'button small ' + (p.status === 'covered' ? 'secondary' : 'primary')} onClick={() => setCover(p)}><UserCheck size={14} />{p.status === 'covered' ? 'Change' : 'Assign'}</button></td>}
    </tr>)}</tbody></table></div> : <Empty title="Every lesson has its teacher" description={'No lesson on ' + o.day + ' is affected by an absence.'} />}
    {cover && <CoverDialog period={cover} date={date} onClose={() => setCover(null)} onSaved={async m => { setCover(null); setMessage(m); await cache.invalidateQueries({ queryKey: ['suite', 'timetable'] }) }} />}
  </>
}

function OfficeTimetable({ canManage, canCover, canOperate }: { canManage: boolean, canCover: boolean, canOperate: boolean }) {
  const cache = useQueryClient(), options = useOptions(), [tab, setTab] = useTab(canOperate ? 'today' : 'class')
  const catalog = useQuery<Module[]>({ queryKey: ['suite', 'catalog'], queryFn: () => data('/catalog') }), module = catalog.data?.find(m => m.kind === 'timetable')
  const [date, setDate] = useState(isoDate()), [classId, setClassId] = useState(''), [teacherId, setTeacherId] = useState(''), [room, setRoom] = useState('')
  const [edit, setEdit] = useState<Period | null | undefined>(), [copy, setCopy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  const params = tab === 'class' ? { classId } : tab === 'teacher' ? { teacherId } : tab === 'room' ? { room } : {}
  const week = useWeek({ ...params, date }, tab === 'class' ? !!classId : tab === 'teacher' ? !!teacherId : tab === 'room' ? !!room : false)
  async function refresh(m: string) { setMessage(m); setError(''); await cache.invalidateQueries({ queryKey: ['suite', 'timetable'] }) }
  async function archive(p: Period) { if (!window.confirm('Remove ' + p.subjectName + ' on ' + p.day + ' at ' + p.startsAt + ' from the timetable?')) return; try { await client.delete('/suite/records/timetable/' + p.id); await refresh('Period removed.') } catch (e) { setError(errorMessage(e)) } }
  async function copyDay(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const v = Object.fromEntries(new FormData(e.currentTarget)); try { const r = await client.post('/suite/timetable/copy', { classId, fromDay: v.fromDay, toDay: v.toDay }); setCopy(false); await refresh(r.data.data.copied + ' period(s) copied to ' + v.toDay + '.') } catch (err) { setError(errorMessage(err)) } }
  const tabs: [string, string][] = [...(canOperate ? [['today', 'Today'] as [string, string]] : []), ['class', 'Class'], ['teacher', 'Teacher'], ['room', 'Room'], ['periods', 'Period structure']]
  return <><PageHeader eyebrow="TIMETABLE" title="Timetable" description="The school day by class, teacher and room, and who covers each lesson when a teacher is away.">
    {canManage && tab === 'class' && classId && <><button className="button secondary" onClick={() => { setError(''); setCopy(true) }}><Copy size={16} />Copy a day</button><button className="button primary" onClick={() => { setError(''); setEdit(null) }}><Plus size={17} />Add period</button></>}
    {canManage && tab !== 'class' && tab !== 'today' && <button className="button primary" onClick={() => { setError(''); setEdit(null) }}><Plus size={17} />Add period</button>}
  </PageHeader>
    <Tabs tabs={tabs} active={tab} pick={setTab} />
    {error && <ErrorBox message={error} />}{message && <div className="success-box" role="status">{message}</div>}
    {tab === 'today' && <section className="panel tt-panel"><div className="panel-heading"><div><h2>Cover for the day</h2><p>Teachers on approved leave or marked absent, and the lessons that need someone</p></div><DateNav date={date} set={setDate} /></div><OperationsPanel date={date} canCover={canCover} /></section>}
    {tab === 'class' && <section className="panel tt-panel"><div className="panel-heading"><div><h2>Class timetable</h2><p>Lessons, teachers and rooms for one class</p></div><label className="child-switcher">Class <select aria-label="Choose class" value={classId} onChange={e => setClassId(e.target.value)}><option value="">Select…</option>{options.data?.classes?.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label></div>
      {!classId ? <Empty title="Choose a class" description="Pick a class to see and edit its week." /> : week.isPending ? <Loading /> : week.isError ? <ErrorBox message={errorMessage(week.error)} /> : <WeekGrid week={week.data} mode="class" onEdit={canManage ? p => { setError(''); setEdit(p) } : undefined} onArchive={canManage ? archive : undefined} />}</section>}
    {tab === 'teacher' && <section className="panel tt-panel"><div className="panel-heading"><div><h2>Teacher timetable</h2><p>Every lesson one teacher takes, with substitutes shown for this week</p></div><label className="child-switcher">Teacher <select aria-label="Choose teacher" value={teacherId} onChange={e => setTeacherId(e.target.value)}><option value="">Select…</option>{options.data?.teachers?.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label></div>
      {!teacherId ? <Empty title="Choose a teacher" description="Pick a teacher to see their week." /> : week.isPending ? <Loading /> : week.isError ? <ErrorBox message={errorMessage(week.error)} /> : <WeekGrid week={week.data} mode="teacher" />}</section>}
    {tab === 'room' && <section className="panel tt-panel"><div className="panel-heading"><div><h2>Room timetable</h2><p>What happens in one room across the week</p></div><label className="child-switcher">Room <input aria-label="Room" value={room} placeholder="e.g. Lab 2" maxLength={60} onChange={e => setRoom(e.target.value)} /></label></div>
      {!room ? <Empty title="Enter a room" description="Type a room or location exactly as it appears on periods." /> : week.isPending ? <Loading /> : week.isError ? <ErrorBox message={errorMessage(week.error)} /> : <WeekGrid week={week.data} mode="room" />}</section>}
    {tab === 'periods' && <PeriodStructure canManage={canManage} />}
    {edit !== undefined && module && <PeriodForm module={module} options={options.data} edit={edit} onClose={() => setEdit(undefined)} onSaved={async m => { setEdit(undefined); await refresh(m) }} />}
    {copy && <Dialog title="Copy a day" onClose={() => setCopy(false)}><form onSubmit={copyDay}><div className="form-grid"><label>From<select name="fromDay" required defaultValue="Monday">{DAYS.map(d => <option key={d}>{d}</option>)}</select></label><label>To<select name="toDay" required defaultValue="Tuesday">{DAYS.map(d => <option key={d}>{d}</option>)}</select></label></div><p className="muted">Copies every lesson of this class from one weekday to another. The target day must be empty for the class, and every copied lesson must pass the clash rules.</p><div className="modal-footer"><button type="button" className="button secondary" onClick={() => setCopy(false)}>Cancel</button><button className="button primary">Copy periods</button></div></form></Dialog>}
  </>
}

function PeriodStructure({ canManage }: { canManage: boolean }) {
  const week = useWeek({ date: isoDate() }, true)
  return <section className="panel tt-panel"><div className="panel-heading"><div><h2>Period structure</h2><p>The school’s bell schedule: teaching periods, breaks, lunch, assembly and activities</p></div>{canManage && <Link className="button secondary" to="/suite/period-slots">Manage periods</Link>}</div>
    {week.isPending ? <Loading /> : week.isError ? <ErrorBox message={errorMessage(week.error)} /> : !week.data.slots.length ? <Empty title="No period structure yet" description="Define the school’s periods so lessons can be placed by period rather than by typing times." /> : <div className="table-scroll"><table><thead><tr><th>Order</th><th>Period</th><th>Time</th><th>Type</th></tr></thead><tbody>{week.data.slots.map(s => <tr key={s.id}><td>{s.order}</td><td>{s.name}</td><td>{span(s)}</td><td><span className="status-tag">{s.type}</span></td></tr>)}</tbody></table></div>}
    <p className="muted">Substitutions are recorded under <Link to="/suite/substitutions">Substitutions</Link>; the daily view assigns them.</p></section>
}

function TeacherTimetable() {
  const [tab, setTab] = useTab('today'), [date, setDate] = useState(isoDate())
  const day = useDay({ date }, tab === 'today'), week = useWeek({ date }, tab === 'week')
  const rows = day.data ? gridRows(day.data.slots, day.data.periods) : []
  return <><PageHeader eyebrow="MY TIMETABLE" title="My timetable" description="Your lessons for today and the week, including periods you cover for a colleague." />
    <Tabs tabs={[['today', 'Today'], ['week', 'My week']]} active={tab} pick={setTab} />
    {tab === 'today' && <section className="panel tt-panel"><div className="panel-heading"><div><h2>{day.data?.day ?? dayName()}</h2><p>{day.data?.away ? 'You are on leave today; your lessons are listed with their cover.' : 'Your periods in order; the next one is marked.'}</p></div><DateNav date={date} set={setDate} /></div>
      {day.isPending ? <Loading /> : day.isError ? <ErrorBox message={errorMessage(day.error)} /> : <DayList rows={rows} dayKey={day.data.day} now={date === isoDate() ? nowMinutes() : undefined} office />}</section>}
    {tab === 'week' && <section className="panel tt-panel"><div className="panel-heading"><div><h2>Week of {week.data?.from ?? date}</h2><p>Substitutes shown for this week’s dates</p></div><DateNav date={date} set={setDate} label="Week of" /></div>
      {week.isPending ? <Loading /> : week.isError ? <ErrorBox message={errorMessage(week.error)} /> : <WeekGrid week={week.data} mode="teacher" />}</section>}
  </>
}

function FamilyTimetable({ role }: { role: string }) {
  const options = useOptions(), children = options.data?.students ?? [], [chosen, setChosen] = useState(''), child = children.find(c => c.id === chosen) ?? children[0]
  const [tab, setTab] = useTab('today'), [date, setDate] = useState(isoDate())
  const studentParam = child ? { studentId: child.id } : {}
  // The day is read whichever tab is open: it also tells the week which class the chosen child is in.
  const day = useDay({ ...studentParam, date }, role !== 'Parent' || !!child), week = useWeek({ ...(day.data?.classId ? { classId: day.data.classId } : {}), date }, tab === 'week' && !!day.data)
  const rows = day.data ? gridRows(day.data.slots, day.data.periods) : []
  return <><PageHeader eyebrow={role === 'Student' ? 'MY TIMETABLE' : 'FAMILY'} title={role === 'Student' ? 'My timetable' : 'Class timetable'} description={role === 'Student' ? 'Your periods for today and the week, with the teacher taking each one.' : 'Each child’s periods for today and the week, with the teacher taking each one.'}>
    {role === 'Parent' && children.length > 1 && <label className="child-switcher">Child <select aria-label="Choose child" value={child?.id ?? ''} onChange={e => setChosen(e.target.value)}>{children.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}</PageHeader>
    <Tabs tabs={[['today', 'Today'], ['week', 'Week']]} active={tab} pick={setTab} />
    {tab === 'today' && <section className="panel tt-panel"><div className="panel-heading"><div><h2>{day.data?.day ?? dayName()}{day.data?.className ? ' · ' + day.data.className : ''}</h2><p>Periods in order; a substitute is shown where one takes the lesson</p></div><DateNav date={date} set={setDate} /></div>
      {day.isPending ? <Loading /> : day.isError ? <ErrorBox message={errorMessage(day.error)} /> : <DayList rows={rows} dayKey={day.data.day} now={date === isoDate() ? nowMinutes() : undefined} office={false} />}</section>}
    {tab === 'week' && <section className="panel tt-panel"><div className="panel-heading"><div><h2>Week of {week.data?.from ?? date}</h2><p>{day.data?.className ?? ''}</p></div><DateNav date={date} set={setDate} label="Week of" /></div>
      {week.isPending ? <Loading /> : week.isError ? <ErrorBox message={errorMessage(week.error)} /> : <WeekGrid week={week.data} mode="family" />}</section>}
  </>
}
