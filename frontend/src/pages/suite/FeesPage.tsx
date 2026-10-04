import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CreditCard, FileDown, Printer, Search, Send, Wallet } from 'lucide-react'
import client, { errorMessage } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { Dialog, Empty, ErrorBox, Loading, PageHeader, today } from '../../components/UI'
import { data, printSchoolDocument, workbook, type Options } from './helpers'
import { isAdministrator, isLeadership } from '../../roles'
import { METHODS, STATE_LABEL, concessionLabel, dayLabel, feesNote, methodBreakdown, money, needsReference, payable, paymentProblem, stateTone, type Charge, type Intent, type Ledger, type Payment, type PaymentConfig, type Summary } from './fees'

// Fees & collections. The office finds a student, sees the ledger, records a payment and prints the receipt in a
// few steps; concessions, waivers and reversals keep every figure and need a reason; reports add up the day, the
// outstanding and the dues by class. Families see their own children: instalments, payments, receipts, and an online
// payment only when the school has switched its own provider on. Every figure comes from the server's ledger.
const useOptions = () => useQuery<Options>({ queryKey: ['suite', 'options'], queryFn: () => data('/options') })
export const useLedger = (studentId: string | undefined, page = 1) => useQuery<Ledger>({ queryKey: ['suite', 'fee-ledger', studentId, page], enabled: !!studentId, queryFn: () => data('/fees/ledger/' + studentId, { page }) })
export const useFeeSummary = (enabled = true) => useQuery<Summary>({ queryKey: ['suite', 'fee-summary'], enabled, queryFn: () => data('/fees/summary') })
const refresh = (cache: ReturnType<typeof useQueryClient>) => Promise.all(['fees', 'fee-ledger', 'fee-summary', 'fee-history', 'fee-report', 'payments', 'student360'].map(k => cache.invalidateQueries({ queryKey: ['suite', k] })))
type Tab = 'collect' | 'history' | 'outstanding' | 'daily' | 'classes' | 'settings'

export default function FeesPage() {
  const user = useAuthStore(s => s.user), role = user?.roles[0] ?? '', grants = user?.permissions ?? [], office = isLeadership(role) && grants.includes('fees.view')
  const can = { collect: grants.includes('fees.collect') && isAdministrator(role), manage: grants.includes('fees.manage') && isAdministrator(role) }
  const [tab, setTab] = useState<Tab>('collect'), [message, setMessage] = useState('')
  if (!office) return <FamilyFees student={role === 'Student'} />
  const tabs: [Tab, string][] = [['collect', 'Collect'], ['history', 'Payment history'], ['outstanding', 'Outstanding'], ['daily', 'Daily collection'], ['classes', 'Dues by class'], ...(can.manage ? [['settings', 'Online payments'] as [Tab, string]] : [])]
  return <><PageHeader eyebrow="SCHOOL ACCOUNTS" title="Fees & collections" description={can.collect ? 'Find a student, record what was received, print the receipt. Concessions, waivers and reversals keep every figure and need a reason.' : 'The school ledger: collections, outstanding and dues by class. Payments are recorded by the administrator.'}>
    {can.manage && <><Link className="button secondary" to="/suite/fee-heads">Fee heads</Link><Link className="button secondary" to="/suite/fee-structures">Structures & instalments</Link></>}</PageHeader>
    <SummaryStrip />
    {message && <div className="success-box" role="status">{message}</div>}
    <div className="module-tabs">{tabs.map(([key, label]) => <a key={key} href="#" className={tab === key ? 'active' : ''} onClick={e => { e.preventDefault(); setMessage(''); setTab(key) }}>{label}</a>)}</div>
    {tab === 'collect' && <Collect can={can} onMessage={setMessage} />}
    {tab === 'history' && <History can={can} onMessage={setMessage} />}
    {tab === 'outstanding' && <Outstanding />}
    {tab === 'daily' && <Daily />}
    {tab === 'classes' && <Classes />}
    {tab === 'settings' && <Settings onMessage={setMessage} />}</>
}

function SummaryStrip() {
  const summary = useFeeSummary()
  if (summary.isError) return <ErrorBox message={errorMessage(summary.error)} />
  const s = summary.data, c = s?.totals.currency ?? ''
  return <div className="stats-grid"><div className="stat-card"><strong>{s ? money(c, s.collectedToday) : '—'}</strong><h2>Collected today</h2><p>Completed payments dated today</p></div><div className="stat-card"><strong>{s ? money(c, s.collectedThisMonth) : '—'}</strong><h2>This month</h2><p>{s ? `${s.reversalsThisMonth} reversal${s.reversalsThisMonth === 1 ? '' : 's'}` : ''}</p></div><div className="stat-card"><strong>{s ? money(c, s.totals.outstanding) : '—'}</strong><h2>Outstanding</h2><p>{s ? feesNote(s.totals) : ''}</p></div><div className="stat-card"><strong>{s ? money(c, s.totals.overdue) : '—'}</strong><h2>Overdue</h2><p>{s ? `${s.totals.overdueCount} charge${s.totals.overdueCount === 1 ? '' : 's'} past due` : ''}</p></div></div>
}

/** Find a student, read the ledger, record a payment, print the receipt. */
function Collect({ can, onMessage }: { can: { collect: boolean, manage: boolean }, onMessage: (m: string) => void }) {
  const options = useOptions(), [search, setSearch] = useState(''), [studentId, setStudentId] = useState('')
  const students = (options.data?.students ?? []).filter(s => s.label.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 12)
  return <>
    <section className="panel"><div className="attendance-toolbar"><label>Find a student<span className="search-field"><Search size={16} /><input type="search" value={search} aria-label="Find a student" placeholder="Name" onChange={e => setSearch(e.target.value)} /></span></label>
      {search.trim() && !studentId && <div className="s360-pick"><ul className="dash-list">{students.map(s => <li key={s.id}><div><strong>{s.label}</strong></div><button className="button small secondary" onClick={() => { setStudentId(s.id); setSearch(s.label) }}>Open ledger</button></li>)}{!students.length && <li><div><strong>No student matches</strong></div></li>}</ul></div>}
      {studentId && <div className="attendance-toolbar-actions"><button className="button secondary" onClick={() => { setStudentId(''); setSearch('') }}>Another student</button><Link className="button secondary" to={'/student360/' + studentId}>Student 360</Link></div>}</div></section>
    {studentId ? <LedgerPanel studentId={studentId} can={can} onMessage={onMessage} /> : <section className="panel"><Empty title="Find a student to begin" description="Type a name, open the ledger, record what was received." /></section>}
  </>
}

/** One student's ledger: totals, every charge with its state, payments with receipts, and the office's actions. */
export function LedgerPanel({ studentId, can, onMessage, family }: { studentId: string, can: { collect: boolean, manage: boolean }, onMessage: (m: string) => void, family?: boolean }) {
  const cache = useQueryClient(), [page, setPage] = useState(1), ledger = useLedger(studentId, page)
  const [paying, setPaying] = useState<Charge | null>(null), [concession, setConcession] = useState(false), [changing, setChanging] = useState<Charge | null>(null), [reversing, setReversing] = useState<Payment | null>(null), [intent, setIntent] = useState<Intent | null>(null), [error, setError] = useState('')
  async function receipt(id: string) { setError(''); try { printSchoolDocument('receipt', await data('/fees/receipts/' + id)) } catch (e) { setError(errorMessage(e)) } }
  async function payOnline(charge: Charge) { setError(''); try { const r = await client.post('/suite/fees/online/intents', { chargeId: charge.id }); setIntent(r.data.data) } catch (e) { setError(errorMessage(e)) } }
  if (ledger.isPending) return <Loading />
  if (ledger.isError) return <ErrorBox message={errorMessage(ledger.error)} />
  const l = ledger.data, t = l.totals, c = t.currency, due = payable(l.charges)
  return <>
    {error && <ErrorBox message={error} />}
    <div className="stats-grid"><div className="stat-card"><strong>{money(c, t.net)}</strong><h2>Net payable</h2><p>{money(c, t.applicable)} applicable · {money(c, t.concessions)} concessions</p></div><div className="stat-card"><strong>{money(c, t.paid)}</strong><h2>Paid</h2><p>{l.payments.total} payment{l.payments.total === 1 ? '' : 's'}</p></div><div className="stat-card"><strong>{money(c, t.outstanding)}</strong><h2>Outstanding</h2><p>{feesNote(t)}</p></div><div className="stat-card"><strong>{money(c, t.overdue)}</strong><h2>Overdue</h2><p>{t.overdueCount} charge{t.overdueCount === 1 ? '' : 's'} past due</p></div></div>
    <section className="panel fees-panel"><div className="panel-heading"><div><h2>{l.student.name}</h2><p>{[l.student.admissionNumber && 'Admission ' + l.student.admissionNumber, l.student.class].filter(Boolean).join(' · ')}</p></div>
      <div className="row-actions">{can.collect && due.length > 0 && <button className="button primary" onClick={() => { setError(''); setPaying(due[0]) }}><Wallet size={15} />Record payment</button>}{can.manage && <button className="button secondary" onClick={() => setConcession(true)}>Give concession</button>}{family && l.online.enabled && due.length > 0 && <button className="button primary" onClick={() => payOnline(due[0])}><CreditCard size={15} />Pay online</button>}</div></div>
      {!l.charges.length ? <Empty title="No fees charged yet" description={family ? 'Charges issued by the school appear here.' : 'Issue charges from a fee structure to start the ledger.'} /> : <div className="table-scroll"><table><thead><tr><th>Fee / instalment</th><th>Due</th><th>Net</th><th>Paid</th><th>Outstanding</th><th>State</th>{!family && <th>Actions</th>}</tr></thead>
        <tbody>{l.charges.map(x => <tr key={x.id}><td><strong>{x.description}</strong>{x.concession > 0 && <small className="muted"> · concession {money(c, x.concession)}</small>}{x.note && <small className="muted"> · {x.note}</small>}</td><td>{dayLabel(x.dueDate)}</td><td>{money(c, x.net)}</td><td>{money(c, x.paid)}</td><td>{money(c, x.outstanding)}</td><td><span className={'status-tag ' + stateTone(x.state)}>{STATE_LABEL[x.state]}</span></td>
          {!family && <td><div className="row-actions">{can.collect && x.status === 'Active' && x.outstanding > 0 && <button className="button small primary" onClick={() => { setError(''); setPaying(x) }}>Collect</button>}{can.manage && <button className="button small secondary" onClick={() => setChanging(x)}>{x.status === 'Active' ? 'Waive / cancel' : 'Reactivate'}</button>}</div></td>}</tr>)}</tbody></table></div>}
      {l.concessions.length > 0 && <p className="muted">Concessions: {l.concessions.map(k => `${concessionLabel(k)} · ${k.reason}${k.status === 'Revoked' ? ' (revoked)' : ''}`).join('; ')}</p>}</section>
    <section className="panel fees-panel"><div className="panel-heading"><div><h2>Payments and receipts</h2><p>{l.payments.total} in all · reversed payments stay on record</p></div></div>
      {!l.payments.items.length ? <Empty title="No payments yet" description="Payments recorded by the school office appear here with their receipts." /> : <div className="table-scroll"><table><thead><tr><th>Receipt</th><th>Date</th><th>Fee</th><th>Amount</th><th>Method</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{l.payments.items.map(p => <tr key={p.id} className={p.status === 'Reversed' ? 'reversed-row' : ''}><td>{p.receipt}{p.source === 'online' && <small className="muted"> · online</small>}</td><td>{dayLabel(p.paidOn)}</td><td>{p.description}</td><td>{money(p.currency, p.amount)}</td><td>{p.method}{p.reference ? <small className="muted"> · {p.reference}</small> : null}</td><td><span className={'status-tag ' + (p.status === 'Reversed' ? 'important' : 'active')}>{p.status}</span>{p.reversalReason && <small className="muted"> · {p.reversalReason}</small>}</td>
          <td><div className="row-actions"><button className="button small secondary" onClick={() => receipt(p.id)}><Printer size={14} />Receipt</button>{can.manage && p.status === 'Completed' && <button className="button small secondary" onClick={() => setReversing(p)}>Reverse</button>}</div></td></tr>)}</tbody></table></div>}
      {(l.payments.more || page > 1) && <div className="modal-footer"><button className="button secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Newer</button><button className="button secondary" disabled={!l.payments.more} onClick={() => setPage(page + 1)}>Older</button></div>}</section>
    {paying && <PaymentDialog charge={paying} charges={due} onClose={() => setPaying(null)} onDone={async (receiptNo, id) => { setPaying(null); onMessage('Payment recorded. Receipt ' + receiptNo + '.'); await refresh(cache); await receipt(id) }} />}
    {concession && <ConcessionDialog studentId={studentId} charges={l.charges} onClose={() => setConcession(false)} onDone={async () => { setConcession(false); onMessage('Concession recorded.'); await refresh(cache) }} />}
    {changing && <ReasonDialog title={(changing.status === 'Active' ? 'Waive or cancel · ' : 'Reactivate · ') + changing.description} choices={changing.status === 'Active' ? [['Waived', 'Waive the balance'], ['Cancelled', 'Cancel the charge']] : [['Active', 'Reactivate']]} onClose={() => setChanging(null)}
      onSubmit={async (status, reason) => { await client.post(`/suite/fees/charges/${changing.id}/status`, { status, reason }); setChanging(null); onMessage('Charge ' + status.toLowerCase() + '.'); await refresh(cache) }} />}
    {reversing && <ReasonDialog title={'Reverse payment ' + reversing.receipt} choices={[['Reversed', 'Reverse this payment']]} warning={`${money(reversing.currency, reversing.amount)} by ${reversing.method} on ${dayLabel(reversing.paidOn)}. The receipt stays on record, marked reversed, and the balance reopens.`} onClose={() => setReversing(null)}
      onSubmit={async (_s, reason) => { await client.post(`/suite/fees/payments/${reversing.id}/reverse`, { reason }); setReversing(null); onMessage('Payment ' + reversing.receipt + ' reversed.'); await refresh(cache) }} />}
    {intent && <Dialog title="Online payment" onClose={() => setIntent(null)}><p>Attempt <strong>{intent.orderReference}</strong> for {money(intent.currency, intent.amount)} is <strong>{intent.status.toLowerCase()}</strong> with the school's provider ({intent.provider}).</p><p className="muted">{intent.instructions || 'The receipt is issued only once the provider confirms the payment to the school; returning to this page is not a confirmation.'}</p><div className="modal-footer"><button className="button secondary" onClick={() => setIntent(null)}>Close</button></div></Dialog>}
  </>
}

function PaymentDialog({ charge, charges, onClose, onDone }: { charge: Charge, charges: Charge[], onClose: () => void, onDone: (receipt: string, id: string) => Promise<void> }) {
  const [chargeId, setChargeId] = useState(charge.id), [amount, setAmount] = useState(String(charge.outstanding)), [method, setMethod] = useState<string>('Cash'), [reference, setReference] = useState(''), [paidOn, setPaidOn] = useState(today()), [note, setNote] = useState('')
  const [key] = useState(() => crypto.randomUUID()), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const current = charges.find(x => x.id === chargeId) ?? charge, problem = paymentProblem(amount, current.outstanding, method, reference)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (problem) { setError(problem); return } setBusy(true); setError('')
    try { const r = await client.post('/suite/fees/payments', { chargeId, amount: Number(amount), method, reference: reference.trim(), paidOn, note: note.trim(), idempotencyKey: key }); await onDone(r.data.data.receipt, r.data.data.id) }
    catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return <Dialog title="Record received payment" onClose={() => !busy && onClose()}><form onSubmit={submit}>{error && <ErrorBox message={error} />}
    <div className="form-grid">
      <label className="full-width">Fee / instalment<select value={chargeId} onChange={e => { setChargeId(e.target.value); const next = charges.find(x => x.id === e.target.value); if (next) setAmount(String(next.outstanding)) }}>{charges.map(x => <option key={x.id} value={x.id}>{x.description} · outstanding {money(x.currency, x.outstanding)}{x.overdue ? ' · overdue' : ''}</option>)}</select></label>
      <label>Amount received<input type="number" inputMode="decimal" min={0.01} max={current.outstanding} step="0.01" required value={amount} onChange={e => setAmount(e.target.value)} /><small className="muted">Outstanding {money(current.currency, current.outstanding)}</small></label>
      <label>Method<select value={method} onChange={e => setMethod(e.target.value)}>{METHODS.map(m => <option key={m}>{m}</option>)}</select></label>
      <label>{needsReference(method) ? 'Reference' : 'Reference (optional)'}<input maxLength={150} value={reference} placeholder={needsReference(method) ? 'Transaction, UTR or cheque number' : ''} onChange={e => setReference(e.target.value)} /></label>
      <label>Received on<input type="date" required value={paidOn} max={today()} onChange={e => setPaidOn(e.target.value)} /></label>
      <label className="full-width">Note (optional)<input maxLength={300} value={note} onChange={e => setNote(e.target.value)} /></label>
    </div>
    <p className="muted">A permanent receipt is issued. No money is collected online by this screen.</p>
    <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || !!problem}><Check size={15} />{busy ? 'Saving…' : 'Record and print receipt'}</button></div></form></Dialog>
}

function ConcessionDialog({ studentId, charges, onClose, onDone }: { studentId: string, charges: Charge[], onClose: () => void, onDone: () => Promise<void> }) {
  const [kind, setKind] = useState<'Percent' | 'Fixed'>('Percent'), [value, setValue] = useState(''), [reason, setReason] = useState(''), [chargeId, setChargeId] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError('')
    try { await client.post('/suite/fees/concessions', { studentId, kind, value: Number(value), reason: reason.trim(), chargeId, from, to }); await onDone() } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return <Dialog title="Give a concession" onClose={() => !busy && onClose()}><form onSubmit={submit}>{error && <ErrorBox message={error} />}
    <div className="form-grid">
      <label>Type<select value={kind} onChange={e => setKind(e.target.value as 'Percent' | 'Fixed')}><option value="Percent">Percentage</option><option value="Fixed">Fixed amount</option></select></label>
      <label>{kind === 'Percent' ? 'Percent' : 'Amount'}<input type="number" inputMode="decimal" min={0.01} max={kind === 'Percent' ? 100 : undefined} step="0.01" required value={value} onChange={e => setValue(e.target.value)} /></label>
      <label className="full-width">Applies to<select value={chargeId} onChange={e => setChargeId(e.target.value)}><option value="">Every charge of the student</option>{charges.filter(x => x.status === 'Active').map(x => <option key={x.id} value={x.id}>{x.description}</option>)}</select></label>
      <label>From (optional)<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>To (optional)<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      <label className="full-width">Reason<input required minLength={3} maxLength={300} value={reason} placeholder="Scholarship, sibling, staff ward…" onChange={e => setReason(e.target.value)} /></label>
    </div>
    <p className="muted">A concession changes what is owed from now on. Payments already received are never altered.</p>
    <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Record concession'}</button></div></form></Dialog>
}

function ReasonDialog({ title, choices, warning, onClose, onSubmit }: { title: string, choices: [string, string][], warning?: string, onClose: () => void, onSubmit: (choice: string, reason: string) => Promise<void> }) {
  const [choice, setChoice] = useState(choices[0][0]), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setBusy(true); setError(''); try { await onSubmit(choice, reason.trim()) } catch (err) { setError(errorMessage(err)); setBusy(false) } }
  return <Dialog title={title} onClose={() => !busy && onClose()}><form onSubmit={submit}>{error && <ErrorBox message={error} />}{warning && <p className="info-box">{warning}</p>}
    {choices.length > 1 && <label>Action<select value={choice} onChange={e => setChoice(e.target.value)}>{choices.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
    <label>Reason<textarea rows={3} required minLength={5} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} /></label>
    <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || reason.trim().length < 5}>{busy ? 'Saving…' : choices.find(([v]) => v === choice)?.[1]}</button></div></form></Dialog>
}

function History({ can, onMessage }: { can: { collect: boolean, manage: boolean }, onMessage: (m: string) => void }) {
  const cache = useQueryClient(), [filters, setFilters] = useState({ search: '', from: '', to: '', method: '', status: '' }), [page, setPage] = useState(1), [reversing, setReversing] = useState<Payment | null>(null), [error, setError] = useState('')
  const history = useQuery<{ items: Payment[], total: number, page: number, more: boolean }>({ queryKey: ['suite', 'fee-history', filters, page], queryFn: () => data('/fees/history', { ...filters, page, pageSize: 25 }) })
  async function receipt(id: string) { setError(''); try { printSchoolDocument('receipt', await data('/fees/receipts/' + id)) } catch (e) { setError(errorMessage(e)) } }
  const set = (patch: Partial<typeof filters>) => { setFilters({ ...filters, ...patch }); setPage(1) }
  return <section className="panel fees-panel"><div className="attendance-toolbar">
    <label>Search<span className="search-field"><Search size={16} /><input type="search" aria-label="Search payments" value={filters.search} placeholder="Receipt, reference or name" onChange={e => set({ search: e.target.value })} /></span></label>
    <label>From<input type="date" value={filters.from} onChange={e => set({ from: e.target.value })} /></label><label>To<input type="date" value={filters.to} onChange={e => set({ to: e.target.value })} /></label>
    <label>Method<select value={filters.method} onChange={e => set({ method: e.target.value })}><option value="">Any</option>{METHODS.map(m => <option key={m}>{m}</option>)}<option>Online</option></select></label>
    <label>Status<select value={filters.status} onChange={e => set({ status: e.target.value })}><option value="">Any</option><option>Completed</option><option>Reversed</option></select></label>
    <div className="attendance-toolbar-actions"><button className="button secondary" disabled={!history.data?.items.length} onClick={() => workbook('fee-payments', history.data!.items as unknown as Record<string, unknown>[])}><FileDown size={15} />Excel</button></div></div>
    {error && <ErrorBox message={error} />}
    {history.isPending ? <Loading /> : history.isError ? <ErrorBox message={errorMessage(history.error)} /> : !history.data.items.length ? <Empty title="No payments match" description="Try other dates or a different search." /> : <div className="table-scroll"><table><thead><tr><th>Receipt</th><th>Date</th><th>Student</th><th>Fee</th><th>Amount</th><th>Method</th><th>Received by</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>{history.data.items.map(p => <tr key={p.id}><td>{p.receipt}</td><td>{dayLabel(p.paidOn)}</td><td>{p.student}<small className="muted"> {p.class}</small></td><td>{p.description}</td><td>{money(p.currency, p.amount)}</td><td>{p.method}{p.reference ? <small className="muted"> · {p.reference}</small> : null}</td><td>{p.collectedBy || '—'}</td><td><span className={'status-tag ' + (p.status === 'Reversed' ? 'important' : 'active')}>{p.status}</span></td>
        <td><div className="row-actions"><button className="button small secondary" onClick={() => receipt(p.id)}><Printer size={14} />Receipt</button>{can.manage && p.status === 'Completed' && <button className="button small secondary" onClick={() => setReversing(p)}>Reverse</button>}</div></td></tr>)}</tbody></table></div>}
    {history.data && (history.data.more || page > 1) && <div className="modal-footer"><span className="muted">{history.data.total} payment{history.data.total === 1 ? '' : 's'}</span><button className="button secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Newer</button><button className="button secondary" disabled={!history.data.more} onClick={() => setPage(page + 1)}>Older</button></div>}
    {reversing && <ReasonDialog title={'Reverse payment ' + reversing.receipt} choices={[['Reversed', 'Reverse this payment']]} warning={`${money(reversing.currency, reversing.amount)} from ${reversing.student}. The receipt stays on record, marked reversed, and the balance reopens.`} onClose={() => setReversing(null)}
      onSubmit={async (_s, reason) => { await client.post(`/suite/fees/payments/${reversing.id}/reverse`, { reason }); setReversing(null); onMessage('Payment ' + reversing.receipt + ' reversed.'); await refresh(cache) }} />}</section>
}

function Outstanding() {
  const [overdueOnly, setOverdueOnly] = useState(false), [page, setPage] = useState(1)
  const report = useQuery<{ items: { studentId: string, student: string, class: string, applicable: number, paid: number, outstanding: number, overdue: number, charges: number, currency: string }[], total: number, more: boolean, outstanding: number, overdue: number }>({ queryKey: ['suite', 'fee-report', 'outstanding', overdueOnly, page], queryFn: () => data('/fees/reports/outstanding', { overdueOnly, page, pageSize: 50 }) })
  return <section className="panel fees-panel"><div className="panel-heading"><div><h2>Outstanding by student</h2><p>{report.data ? `${report.data.total} student${report.data.total === 1 ? '' : 's'} · ${money(report.data.items[0]?.currency ?? '', report.data.outstanding)} outstanding · ${money(report.data.items[0]?.currency ?? '', report.data.overdue)} overdue` : ''}</p></div>
    <div className="row-actions"><label className="child-switcher"><input type="checkbox" checked={overdueOnly} onChange={e => { setOverdueOnly(e.target.checked); setPage(1) }} /> Overdue only</label><button className="button secondary" disabled={!report.data?.items.length} onClick={() => workbook('fee-outstanding', report.data!.items as unknown as Record<string, unknown>[])}><FileDown size={15} />Excel</button></div></div>
    {report.isPending ? <Loading /> : report.isError ? <ErrorBox message={errorMessage(report.error)} /> : !report.data.items.length ? <Empty title="Nothing outstanding" description="Every active charge is settled." /> : <div className="table-scroll"><table><thead><tr><th>Student</th><th>Class</th><th>Applicable</th><th>Paid</th><th>Outstanding</th><th>Overdue</th><th></th></tr></thead>
      <tbody>{report.data.items.map(r => <tr key={r.studentId}><td>{r.student}</td><td>{r.class}</td><td>{money(r.currency, r.applicable)}</td><td>{money(r.currency, r.paid)}</td><td><strong>{money(r.currency, r.outstanding)}</strong></td><td>{r.overdue > 0 ? <span className="status-tag important">{money(r.currency, r.overdue)}</span> : '—'}</td><td><Link className="text-link" to={'/student360/' + r.studentId + '?tab=fees'}>Student 360</Link></td></tr>)}</tbody></table></div>}
    {report.data && (report.data.more || page > 1) && <div className="modal-footer"><button className="button secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><button className="button secondary" disabled={!report.data.more} onClick={() => setPage(page + 1)}>Next</button></div>}</section>
}

function Daily() {
  const [day, setDay] = useState(today())
  const report = useQuery<{ day: string, total: number, count: number, reversed: number, byMethod: Record<string, number>, transactions: (Payment & { collectedBy: string })[], currency: string }>({ queryKey: ['suite', 'fee-report', 'daily', day], queryFn: () => data('/fees/reports/daily', { day }) })
  return <section className="panel fees-panel"><div className="panel-heading"><div><h2>Daily collection</h2><p>{report.data ? `${money(report.data.currency, report.data.total)} in ${report.data.count} payment${report.data.count === 1 ? '' : 's'}${report.data.reversed ? ` · ${report.data.reversed} reversed` : ''}${Object.keys(report.data.byMethod).length ? ' · ' + methodBreakdown(report.data.byMethod, report.data.currency) : ''}` : ''}</p></div>
    <div className="row-actions"><label className="child-switcher">Day<input type="date" value={day} max={today()} onChange={e => setDay(e.target.value)} aria-label="Collection day" /></label><button className="button secondary" disabled={!report.data?.transactions.length} onClick={() => workbook('fee-collection-' + day, report.data!.transactions as unknown as Record<string, unknown>[])}><FileDown size={15} />Excel</button></div></div>
    {report.isPending ? <Loading /> : report.isError ? <ErrorBox message={errorMessage(report.error)} /> : !report.data.transactions.length ? <Empty title="No payments on this day" description="Payments dated this day appear here." /> : <div className="table-scroll"><table><thead><tr><th>Receipt</th><th>Student</th><th>Fee</th><th>Amount</th><th>Method</th><th>Received by</th><th>Status</th></tr></thead>
      <tbody>{report.data.transactions.map(p => <tr key={p.id}><td>{p.receipt}</td><td>{p.student}<small className="muted"> {p.class}</small></td><td>{p.description}</td><td>{money(p.currency, p.amount)}</td><td>{p.method}</td><td>{p.collectedBy || '—'}</td><td><span className={'status-tag ' + (p.status === 'Reversed' ? 'important' : 'active')}>{p.status}</span></td></tr>)}</tbody></table></div>}</section>
}

function Classes() {
  const report = useQuery<{ class: string, students: number, applicable: number, paid: number, outstanding: number, overdue: number, currency: string }[]>({ queryKey: ['suite', 'fee-report', 'classes'], queryFn: () => data('/fees/reports/classes') })
  return <section className="panel fees-panel"><div className="panel-heading"><div><h2>Dues by class</h2><p>Active charges only</p></div></div>
    {report.isPending ? <Loading /> : report.isError ? <ErrorBox message={errorMessage(report.error)} /> : !report.data.length ? <Empty title="No charges yet" description="Dues by class appear once charges are issued." /> : <div className="table-scroll"><table><thead><tr><th>Class</th><th>Students</th><th>Applicable</th><th>Paid</th><th>Outstanding</th><th>Overdue</th></tr></thead>
      <tbody>{report.data.map(r => <tr key={r.class}><td>{r.class || 'Not allocated'}</td><td>{r.students}</td><td>{money(r.currency, r.applicable)}</td><td>{money(r.currency, r.paid)}</td><td><strong>{money(r.currency, r.outstanding)}</strong></td><td>{r.overdue > 0 ? <span className="status-tag important">{money(r.currency, r.overdue)}</span> : '—'}</td></tr>)}</tbody></table></div>}</section>
}

/** The school's own payment relationship. No credential is entered or shown here; the deployment holds those. */
function Settings({ onMessage }: { onMessage: (m: string) => void }) {
  const cache = useQueryClient(), config = useQuery<PaymentConfig>({ queryKey: ['suite', 'fee-config'], queryFn: () => data('/fees/payment-config') })
  const [draft, setDraft] = useState<{ provider: string, merchantReference: string, onlineEnabled: boolean } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  if (config.isPending) return <Loading />
  if (config.isError) return <ErrorBox message={errorMessage(config.error)} />
  const k = config.data, d = draft ?? { provider: k.provider, merchantReference: k.merchantReference, onlineEnabled: k.onlineEnabled }
  async function save(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setBusy(true); setError(''); try { await client.put('/suite/fees/payment-config', d); setDraft(null); onMessage('Payment settings saved.'); await cache.invalidateQueries({ queryKey: ['suite', 'fee-config'] }); await refresh(cache) } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) } }
  return <section className="panel fees-panel"><div className="panel-heading"><div><h2>Online payments for this school</h2><p>Families pay into the school's own provider account, never into an EduOS account. EduOS's own subscription billing is separate and unaffected.</p></div></div>
    <div className="kpi-row"><div><span>Provider</span><strong>{k.provider}</strong></div><div><span>Connection</span><strong>{k.connectionStatus}</strong></div><div><span>Settlement</span><strong>{k.settlementStatus}</strong></div><div><span>Online payments</span><strong>{k.onlineEnabled ? 'On' : 'Off'}</strong></div></div>
    <form onSubmit={save}>{error && <ErrorBox message={error} />}<div className="form-grid">
      <label>Provider<select value={d.provider} onChange={e => setDraft({ ...d, provider: e.target.value })}>{k.providers.map(p => <option key={p} value={p}>{p === 'none' ? 'None (offline collection only)' : p === 'fake' ? 'Test provider (no real money)' : 'Razorpay (awaiting school onboarding model)'}</option>)}</select></label>
      <label>Merchant / linked account reference<input maxLength={120} value={d.merchantReference} placeholder="Given by the provider once the school is onboarded" onChange={e => setDraft({ ...d, merchantReference: e.target.value })} /></label>
      <label className="full-width"><input type="checkbox" checked={d.onlineEnabled} onChange={e => setDraft({ ...d, onlineEnabled: e.target.checked })} /> Allow families to pay online (only works once the provider is connected)</label></div>
      <p className="muted">{k.note}</p>
      <div className="modal-footer"><button className="button primary" disabled={busy || !draft}><Send size={15} />{busy ? 'Saving…' : 'Save settings'}</button></div></form></section>
}

/** Families: each child's ledger, instalments, payments and receipts; an online payment only when the school allows it. */
function FamilyFees({ student }: { student: boolean }) {
  const options = useOptions(), children = options.data?.students ?? [], [chosen, setChosen] = useState(''), child = children.find(c => c.id === chosen) ?? children[0], [message, setMessage] = useState('')
  return <><PageHeader eyebrow={student ? 'MY FEES' : 'FAMILY'} title="Fees & receipts" description={student ? 'Your instalments, what was paid, and your receipts.' : 'Each child’s instalments, what was paid, and receipts.'}>
    {!student && children.length > 1 && <label className="child-switcher">Child<select aria-label="Choose child" value={child?.id ?? ''} onChange={e => setChosen(e.target.value)}>{children.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}</PageHeader>
    {message && <div className="success-box" role="status">{message}</div>}
    {options.isPending ? <Loading /> : !child ? <section className="panel"><Empty title={student ? 'Your student record is not linked yet' : 'No children linked yet'} description="Ask the school administrator to link this account to the student record." /></section> : <LedgerPanel key={child.id} studentId={child.id} can={{ collect: false, manage: false }} onMessage={setMessage} family />}</>
}
