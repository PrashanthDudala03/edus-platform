import { FormEvent, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Check, X, CalendarCheck, Scale } from 'lucide-react'
import client, { errorMessage } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { Dialog, Empty, ErrorBox, Loading, PageHeader } from '../../components/UI'
import { data, type Options } from './helpers'
import { isLeadership } from '../../roles'
import { OperationsPanel } from './TimetablePage'
import { type Balances, type Leave, type QueueItem, type Impact, HALF_DAYS, leaveDays, fmtDays, range, statusTone, canCancel, balanceNote, defaultType, impactWord, byMonth } from './leave'

// Leave & Approvals 2.0: a teacher sees balances, asks for leave and withdraws a pending request; leadership works a
// queue that shows the balance and the lessons each request would leave uncovered, decides with a remark, and covers
// the day. Days, balances and impact are the server's figures; the page never adds them up itself.
export default function LeavePage() {
  const user = useAuthStore(s => s.user), role = user?.roles?.[0] || ''
  if (isLeadership(role)) return <LeadershipLeave canApprove={!!user?.permissions.includes('leave-requests.approve')} canAdjust={!!user?.permissions.includes('leave-adjustments.manage')} canCover={!!user?.permissions.includes('substitutions.manage')} canOperate={!!user?.permissions.includes('substitutions.view')} />
  if (role === 'Teacher') return <TeacherLeave canRequest={!!user?.permissions.includes('leave-requests.manage')} />
  return <Empty title="Leave is a staff workspace" description="Leave requests and balances belong to staff profiles." />
}

const useOptions = () => useQuery<Options>({ queryKey: ['suite', 'options'], queryFn: () => data('/options') })
const useLeave = (search = '') => useQuery<{ data: Leave[], totalCount: number }>({ queryKey: ['suite', 'leave-requests', 'page', search], queryFn: () => data('/records/leave-requests', { page: 1, search }) })
const useBalances = (teacherId?: string, enabled = true) => useQuery<Balances>({ queryKey: ['suite', 'leave', 'balances', teacherId ?? 'me'], queryFn: () => data('/leave/balances', teacherId ? { teacherId } : undefined), enabled })
const Tabs = ({ tabs, active, pick }: { tabs: [string, string][], active: string, pick: (t: string) => void }) => <div className="module-tabs" role="tablist">{tabs.map(([key, label]) => <a key={key} href="#" role="tab" aria-selected={active === key} className={active === key ? 'selected' : ''} onClick={e => { e.preventDefault(); pick(key) }}>{label}</a>)}</div>
function useTab(fallback: string) { const [params, setParams] = useSearchParams(); return [params.get('tab') || fallback, (t: string) => setParams(p => { p.set('tab', t); return p }, { replace: true })] as const }

function BalanceTiles({ b }: { b: Balances }) {
  if (!b.balances.length) return <div className="info-box">No leave types are configured yet. Requests can still be submitted without a type.</div>
  return <div className="stats-grid leave-grid">{b.balances.map(x => <div key={x.typeId} className="stat-card"><div className="stat-top"><span className="stat-icon teal"><Scale size={20} /></span></div><strong>{x.tracksBalance ? fmtDays(x.remaining) : '∞'}</strong><h3>{x.name}</h3><p>{balanceNote(x)}{x.paid === 'Unpaid' ? ' · unpaid' : ''}</p></div>)}</div>
}

function LeaveTable({ rows, options, mine, approver, onCancel, onImpact }: { rows: Leave[], options?: Options, mine: (r: Leave) => boolean, approver: boolean, onCancel: (r: Leave) => void, onImpact?: (r: Leave) => void }) {
  const typeName = (id: string) => options?.['leave-types']?.find(t => t.id === id)?.label ?? '—'
  if (!rows.length) return <Empty title="No leave requests" description="Requests appear here as they are made." />
  return <div className="table-scroll"><table className="leave-table"><thead><tr>{approver && <th>Staff member</th>}<th>Dates</th><th>Type</th><th>Days</th><th>Reason</th><th>Status</th><th>Remark</th><th>Actions</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}>
    {approver && <td>{options?.teachers?.find(t => t.id === r.teacherId)?.label ?? '—'}</td>}<td>{range(r.fromDate, r.toDate, r.halfDay)}</td><td>{typeName(r.typeId)}</td><td>{fmtDays(r.days ?? leaveDays(r.fromDate, r.toDate, r.halfDay))}</td><td className="truncate-cell">{r.reason}</td>
    <td><span className={'status-tag ' + statusTone(r.status)}>{r.status}</span></td><td className="truncate-cell">{r.approvalRemark || '—'}</td>
    <td><div className="row-actions">{onImpact && <button className="button small secondary" onClick={() => onImpact(r)}>Impact</button>}{canCancel(r.status, mine(r), approver) && <button className="button small secondary" onClick={() => onCancel(r)}><X size={14} />{r.status === 'Pending' && mine(r) && !approver ? 'Withdraw' : 'Cancel'}</button>}</div></td></tr>)}</tbody></table></div>
}

function ImpactDialog({ leave, onClose, canCover }: { leave: Leave, onClose: () => void, canCover: boolean }) {
  const impact = useQuery<Impact>({ queryKey: ['suite', 'leave', 'impact', leave.id], queryFn: () => data('/leave/' + leave.id + '/impact') })
  return <Dialog title={'Timetable impact · ' + range(leave.fromDate, leave.toDate, leave.halfDay)} onClose={onClose}>
    {impact.isPending ? <Loading /> : impact.isError ? <ErrorBox message={errorMessage(impact.error)} /> : <>
      <p className="muted">{impact.data.teacherName} · {fmtDays(impact.data.days)} day(s) · {impactWord(impact.data.summary)}</p>
      {impact.data.periods.length ? <div className="table-scroll"><table><thead><tr><th>Date</th><th>Time</th><th>Class</th><th>Subject</th><th>Cover</th></tr></thead><tbody>{impact.data.periods.map(p => <tr key={p.id + p.date} className={p.status === 'uncovered' ? 'tt-uncovered' : ''}><td>{p.date}</td><td>{p.startsAt}–{p.endsAt}</td><td>{p.className}</td><td>{p.subjectName}</td><td><span className={'status-tag ' + (p.status === 'covered' ? 'active' : 'important')}>{p.status === 'covered' ? p.substitution?.teacherName : 'Needs cover'}</span></td></tr>)}</tbody></table></div> : <Empty title="No lessons affected" description="Nothing on the timetable falls on these dates for this teacher." />}
      {canCover && leave.status === 'Approved' && impact.data.summary.uncovered > 0 && <p className="muted">Assign substitutes from <Link to={'/suite/timetable?tab=today'}>Timetable · Today</Link>.</p>}
    </>}
    <div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Close</button></div></Dialog>
}

function RequestDialog({ balances, teacherId, onClose, onSaved }: { balances?: Balances, teacherId: string, onClose: () => void, onSaved: (m: string) => void }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [from, setFrom] = useState(''), [to, setTo] = useState(''), [half, setHalf] = useState('No')
  const types = balances?.balances.filter(b => b.active) ?? [], [typeId, setTypeId] = useState(defaultType(types))
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError('')
    const v = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    try { await client.post('/suite/records/leave-requests', { teacherId, typeId: v.typeId ?? '', fromDate: v.fromDate, toDate: half === 'No' ? v.toDate : v.fromDate, halfDay: half, reason: v.reason, status: 'Pending' }); onSaved('Leave request submitted.') } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  const days = leaveDays(from, half === 'No' ? to : from, half), chosen = types.find(t => t.typeId === typeId)
  return <Dialog title="Request leave" onClose={() => !busy && onClose()}><form onSubmit={save}>{error && <ErrorBox message={error} />}
    <div className="form-grid">
      {types.length > 0 && <label>Leave type<select name="typeId" required value={typeId} onChange={e => setTypeId(e.target.value)}>{types.map(t => <option key={t.typeId} value={t.typeId}>{t.name}{t.tracksBalance ? ' · ' + fmtDays(t.afterPending) + ' left' : ''}</option>)}</select></label>}
      <label>Half day<select value={half} onChange={e => setHalf(e.target.value)}>{HALF_DAYS.map(h => <option key={h}>{h}</option>)}</select></label>
      <label>From<input name="fromDate" type="date" required value={from} onChange={e => setFrom(e.target.value)} /></label>
      {half === 'No' && <label>Through<input name="toDate" type="date" required value={to} min={from} onChange={e => setTo(e.target.value)} /></label>}
      <label className="full-width">Reason<textarea name="reason" required maxLength={4000} rows={3} /></label>
    </div>
    <p className="muted">{days ? fmtDays(days) + ' day(s)' : 'Choose dates'}{chosen?.tracksBalance && days > (chosen.afterPending ?? 0) ? ' · more than the balance left for ' + chosen.name : ''}</p>
    <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</button></div></form></Dialog>
}

function TeacherLeave({ canRequest }: { canRequest: boolean }) {
  const cache = useQueryClient(), options = useOptions(), balances = useBalances(), mine = useLeave(), [tab, setTab] = useTab('requests')
  const [request, setRequest] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  const rows = (mine.data?.data ?? []).sort((a, b) => b.fromDate.localeCompare(a.fromDate))
  async function refresh(m: string) { setMessage(m); setError(''); await cache.invalidateQueries({ queryKey: ['suite'] }) }
  async function withdraw(r: Leave) { if (!window.confirm('Withdraw this leave request?')) return; try { await client.post('/suite/leave/' + r.id + '/cancel', { version: r.version }); await refresh('Request withdrawn.') } catch (e) { setError(errorMessage(e)) } }
  return <><PageHeader eyebrow="MY LEAVE" title="My leave" description="Your balances, your requests and their decisions.">{canRequest && balances.data && <button className="button primary" onClick={() => { setError(''); setRequest(true) }}><Plus size={17} />Request leave</button>}</PageHeader>
    <Tabs tabs={[['requests', 'Requests'], ['balance', 'Balance']]} active={tab} pick={setTab} />
    {error && <ErrorBox message={error} />}{message && <div className="success-box" role="status">{message}</div>}
    {balances.isPending ? <Loading /> : balances.isError ? <ErrorBox message={errorMessage(balances.error)} /> : <>
      {tab === 'balance' && <section className="panel leave-panel"><div className="panel-heading"><div><h2>Balance · {balances.data.year.name}</h2><p>{balances.data.year.from} to {balances.data.year.to}. Approved leave is taken; pending leave is still asked for.</p></div></div><BalanceTiles b={balances.data} />
        {balances.data.balances.some(b => b.tracksBalance) && <div className="table-scroll"><table><thead><tr><th>Type</th><th>Allowance</th><th>Adjusted</th><th>Taken</th><th>Pending</th><th>Remaining</th></tr></thead><tbody>{balances.data.balances.filter(b => b.tracksBalance).map(b => <tr key={b.typeId}><td>{b.name}</td><td>{fmtDays(b.allowance)}</td><td>{b.added - b.deducted >= 0 ? '+' : ''}{fmtDays(b.added - b.deducted)}</td><td>{fmtDays(b.used)}</td><td>{fmtDays(b.pending)}</td><td><strong>{fmtDays(b.remaining)}</strong></td></tr>)}</tbody></table></div>}</section>}
      {tab === 'requests' && <section className="panel leave-panel"><div className="panel-heading"><div><h2>My requests</h2><p>Newest first; pending requests can be withdrawn</p></div></div>
        {mine.isPending ? <Loading /> : mine.isError ? <ErrorBox message={errorMessage(mine.error)} /> : <LeaveTable rows={rows} options={options.data} mine={() => true} approver={false} onCancel={withdraw} />}</section>}
      {request && <RequestDialog balances={balances.data} teacherId={balances.data.teacherId} onClose={() => setRequest(false)} onSaved={async m => { setRequest(false); await refresh(m) }} />}
    </>}
  </>
}

function DecisionDialog({ item, decision, onClose, onSaved }: { item: QueueItem, decision: 'Approved' | 'Rejected', onClose: () => void, onSaved: (m: string) => void }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError('')
    const remark = String(new FormData(e.currentTarget).get('remark') ?? '')
    try { await client.post('/suite/leave/' + item.id + '/decision', { decision, remark, version: item.version }); onSaved(decision === 'Approved' ? 'Leave approved.' : 'Leave rejected.') } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return <Dialog title={(decision === 'Approved' ? 'Approve' : 'Reject') + ' leave · ' + item.teacherName} onClose={() => !busy && onClose()}><form onSubmit={save}>{error && <ErrorBox message={error} />}
    <p className="muted">{range(item.fromDate, item.toDate, item.halfDay)} · {fmtDays(item.days)} day(s) · {item.typeName || 'No type'}{item.tracksBalance ? ' · ' + fmtDays(item.remaining) + ' left' : ''} · {impactWord(item.impact)}</p>
    <p>{item.reason}</p>
    <label className="full-width">{decision === 'Rejected' ? 'Reason for rejecting' : 'Remark (optional)'}<textarea name="remark" required={decision === 'Rejected'} maxLength={4000} rows={3} /></label>
    <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className={'button ' + (decision === 'Approved' ? 'primary' : 'secondary')} disabled={busy}>{busy ? 'Saving…' : decision === 'Approved' ? 'Approve' : 'Reject'}</button></div></form></Dialog>
}

function AdjustDialog({ teacherId, balances, onClose, onSaved }: { teacherId: string, balances: Balances, onClose: () => void, onSaved: (m: string) => void }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), tracked = balances.balances.filter(b => b.tracksBalance)
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError('')
    const v = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    try { await client.post('/suite/records/leave-adjustments', { teacherId, typeId: v.typeId, direction: v.direction, days: v.days, effectiveOn: v.effectiveOn, reason: v.reason }); onSaved('Balance adjusted.') } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return <Dialog title={'Adjust balance · ' + balances.teacherName} onClose={() => !busy && onClose()}><form onSubmit={save}>{error && <ErrorBox message={error} />}
    {!tracked.length ? <p className="muted">No leave type tracks a balance.</p> : <div className="form-grid"><label>Leave type<select name="typeId" required>{tracked.map(t => <option key={t.typeId} value={t.typeId}>{t.name} · {fmtDays(t.remaining)} left</option>)}</select></label><label>Direction<select name="direction"><option>Add</option><option>Deduct</option></select></label><label>Days<input name="days" type="number" step="0.5" min="0.5" max="366" required /></label><label>Effective on<input name="effectiveOn" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label><label className="full-width">Reason<textarea name="reason" required maxLength={4000} rows={2} /></label></div>}
    <p className="muted">Adjustments are a permanent, audited history: a mistake is corrected with another adjustment.</p>
    <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || !tracked.length}>{busy ? 'Saving…' : 'Save adjustment'}</button></div></form></Dialog>
}

function LeadershipLeave({ canApprove, canAdjust, canCover, canOperate }: { canApprove: boolean, canAdjust: boolean, canCover: boolean, canOperate: boolean }) {
  const cache = useQueryClient(), options = useOptions(), [tab, setTab] = useTab('queue')
  const queue = useQuery<{ items: QueueItem[], total: number, canApprove: boolean }>({ queryKey: ['suite', 'leave', 'queue'], queryFn: () => data('/leave/queue') }), all = useLeave()
  const [decide, setDecide] = useState<{ item: QueueItem, decision: 'Approved' | 'Rejected' } | null>(null), [impact, setImpact] = useState<Leave | null>(null), [teacherId, setTeacherId] = useState(''), [adjust, setAdjust] = useState(false)
  const [message, setMessage] = useState(''), [error, setError] = useState('')
  const balances = useBalances(teacherId, !!teacherId), today = new Date().toISOString().slice(0, 10)
  async function refresh(m: string) { setMessage(m); setError(''); await cache.invalidateQueries({ queryKey: ['suite'] }) }
  async function cancel(r: Leave) { const remark = window.prompt('Reason for cancelling this leave?'); if (remark === null) return; try { await client.post('/suite/leave/' + r.id + '/cancel', { remark, version: r.version }); await refresh('Leave cancelled.') } catch (e) { setError(errorMessage(e)) } }
  const rows = (all.data?.data ?? []).sort((a, b) => b.fromDate.localeCompare(a.fromDate))
  return <><PageHeader eyebrow="STAFF LEAVE" title="Leave approvals" description="Pending requests with the balance and the lessons each would leave uncovered; decisions are recorded with who made them.">
    <Link className="button secondary" to="/suite/leave-types">Leave types</Link></PageHeader>
    <Tabs tabs={[['queue', 'Pending approvals'], ['calendar', 'Calendar'], ['balances', 'Balances'], ...(canOperate ? [['cover', 'Cover today'] as [string, string]] : [])]} active={tab} pick={setTab} />
    {error && <ErrorBox message={error} />}{message && <div className="success-box" role="status">{message}</div>}
    {tab === 'queue' && <section className="panel leave-panel"><div className="panel-heading"><div><h2>Pending approvals</h2><p>{queue.data ? queue.data.total + ' waiting' : ''}</p></div></div>
      {queue.isPending ? <Loading /> : queue.isError ? <ErrorBox message={errorMessage(queue.error)} /> : !queue.data.items.length ? <Empty title="Nothing waiting" description="New requests from staff appear here." /> : <ul className="dash-list leave-queue">{queue.data.items.map(i => <li key={i.id}><span className="stat-icon peach"><CalendarCheck size={17} /></span>
        <div><strong>{i.teacherName} · {range(i.fromDate, i.toDate, i.halfDay)} · {fmtDays(i.days)} day(s)</strong><small>{i.typeName || 'No type'}{i.tracksBalance ? ' · ' + fmtDays(i.remaining) + ' left' : ''} · <span className={i.impact.uncovered ? 'text-warn' : ''}>{impactWord(i.impact)}</span></small><small>{i.reason}</small></div>
        <div className="row-actions"><button className="button small secondary" onClick={() => setImpact(i)}>Impact</button>{canApprove && <><button className="button small primary" onClick={() => setDecide({ item: i, decision: 'Approved' })}><Check size={14} />Approve</button><button className="button small secondary" onClick={() => setDecide({ item: i, decision: 'Rejected' })}><X size={14} />Reject</button></>}</div></li>)}</ul>}</section>}
    {tab === 'calendar' && <section className="panel leave-panel"><div className="panel-heading"><div><h2>Leave calendar</h2><p>Every request by month, newest first</p></div></div>
      {all.isPending ? <Loading /> : all.isError ? <ErrorBox message={errorMessage(all.error)} /> : !rows.length ? <Empty title="No leave yet" description="Requests appear here as they are made." /> : byMonth(rows).map(([month, list]) => <div key={month}><h3 className="leave-month">{month}</h3><LeaveTable rows={list} options={options.data} mine={() => false} approver={canApprove} onCancel={cancel} onImpact={r => setImpact(r)} /></div>)}</section>}
    {tab === 'balances' && <section className="panel leave-panel"><div className="panel-heading"><div><h2>Balances</h2><p>One staff member's balances this year, with adjustments</p></div><div className="row-actions"><label className="child-switcher">Staff member <select aria-label="Choose staff member" value={teacherId} onChange={e => setTeacherId(e.target.value)}><option value="">Select…</option>{options.data?.teachers?.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>{canAdjust && teacherId && balances.data && <button className="button secondary" onClick={() => setAdjust(true)}>Adjust balance</button>}</div></div>
      {!teacherId ? <Empty title="Choose a staff member" description="Balances are shown per person." /> : balances.isPending ? <Loading /> : balances.isError ? <ErrorBox message={errorMessage(balances.error)} /> : <><BalanceTiles b={balances.data} />
        {balances.data.adjustments.length > 0 && <div className="table-scroll"><table><thead><tr><th>Effective</th><th>Type</th><th>Change</th><th>Reason</th></tr></thead><tbody>{balances.data.adjustments.map(a => <tr key={a.id}><td>{a.effectiveOn}</td><td>{balances.data.balances.find(b => b.typeId === a.typeId)?.name ?? '—'}</td><td>{a.direction === 'Add' ? '+' : '−'}{fmtDays(a.days)}</td><td>{a.reason}</td></tr>)}</tbody></table></div>}</>}</section>}
    {tab === 'cover' && <section className="panel leave-panel"><div className="panel-heading"><div><h2>Cover today</h2><p>Lessons affected by today's absences</p></div><Link className="text-link" to="/suite/timetable?tab=today">Open the day</Link></div><OperationsPanel date={today} canCover={canCover} compact /></section>}
    {decide && <DecisionDialog item={decide.item} decision={decide.decision} onClose={() => setDecide(null)} onSaved={async m => { setDecide(null); await refresh(m) }} />}
    {impact && <ImpactDialog leave={impact} canCover={canCover} onClose={() => setImpact(null)} />}
    {adjust && balances.data && <AdjustDialog teacherId={teacherId} balances={balances.data} onClose={() => setAdjust(false)} onSaved={async m => { setAdjust(false); await refresh(m) }} />}
  </>
}
