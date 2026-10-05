import { FormEvent, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, ArrowLeft, Check, AlertTriangle, UserPlus, ArrowUpRight } from 'lucide-react'
import client, { errorMessage } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { Dialog, Empty, ErrorBox, Loading, PageHeader, Pagination } from '../../components/UI'
import { data, type Module, type Options, type Row } from './helpers'
import { SuiteInput, Attachments } from './SuitePage'
import { type Pipeline, type Detail, type FormQuestion, type Step, TABS, RELATIONSHIPS, DOCUMENT_STATUSES, statusTone, decisionsFor, editable, docProgress, nextStep, percent, hiddenPassword, answerValue, choices, shortDate } from './admissions'

// Admissions 2.0 and Student Onboarding 2.0: one workspace from application to active student. The office filters the
// pipeline, opens an application, decides it, and once approved works through the onboarding checklist; activation
// creates the guardian, student, enrolment, charges and account links in one step on the server.
export default function AdmissionsPage() {
  const [params, setParams] = useSearchParams(), id = params.get('id')
  const open = (next: string | null) => setParams(p => { if (next) p.set('id', next); else p.delete('id'); return p })
  return id ? <ApplicationView id={id} back={() => open(null)} /> : <PipelineView open={open} />
}

const useOptions = () => useQuery<Options>({ queryKey: ['suite', 'options'], queryFn: () => data('/options') })

function PipelineView({ open }: { open: (id: string) => void }) {
  const options = useOptions(), [tab, setTab] = useState('All'), [search, setSearch] = useState(''), [classId, setClassId] = useState(''), [missing, setMissing] = useState(false), [page, setPage] = useState(1), [create, setCreate] = useState(false)
  const pipeline = useQuery<Pipeline>({ queryKey: ['suite', 'admissions', 'pipeline', tab, search, classId, missing, page], queryFn: () => data('/admissions/pipeline', { ...(tab === 'All' ? {} : { status: tab }), ...(search ? { search } : {}), ...(classId ? { classId } : {}), ...(missing ? { missingDocuments: true } : {}), page }) })
  const counts = pipeline.data?.counts, all = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0
  return <><PageHeader eyebrow="ADMISSIONS" title="Admissions" description="Applications from enquiry to active student: review, decide, onboard and activate.">
    {pipeline.data?.canManage && <button className="button primary" onClick={() => setCreate(true)}><Plus size={17} />New application</button>}{pipeline.data?.canManage && <Link className="button secondary" to="/suite/admission-fields">Admission form</Link>}</PageHeader>
    <div className="stats-grid adm-summary">{(['Submitted', 'Under Review', 'Approved', 'Onboarding', 'Ready'] as const).map(s => <button key={s} className="stat-card" onClick={() => { setTab(s); setPage(1) }}><strong>{counts?.[s] ?? '—'}</strong><span className="adm-card-title">{s}</span><p>{s === 'Submitted' ? 'Waiting for review' : s === 'Under Review' ? 'Being reviewed' : s === 'Approved' ? 'Ready to start onboarding' : s === 'Onboarding' ? 'Checklist in progress' : 'Ready to activate'}</p></button>)}</div>
    <div className="module-tabs" role="tablist">{TABS.map(t => <a key={t} href="#" role="tab" aria-selected={tab === t} className={tab === t ? 'selected' : ''} onClick={e => { e.preventDefault(); setTab(t); setPage(1) }}>{t}{t === 'All' ? ' · ' + all : counts ? ' · ' + (counts[t as keyof typeof counts] ?? 0) : ''}</a>)}</div>
    <section className="panel adm-panel"><div className="directory-toolbar"><div><h2>{tab === 'All' ? 'All applications' : tab}</h2><p>{pipeline.data?.total ?? 0} application(s)</p></div>
      <div className="toolbar-actions"><input aria-label="Search applications" placeholder="Name, number or guardian…" maxLength={100} value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        <select aria-label="Class" value={classId} onChange={e => { setClassId(e.target.value); setPage(1) }}><option value="">All classes</option>{options.data?.classes?.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        <label className="adm-check"><input type="checkbox" checked={missing} onChange={e => { setMissing(e.target.checked); setPage(1) }} />Missing documents</label></div></div>
      {pipeline.isPending ? <Loading /> : pipeline.isError ? <ErrorBox message={errorMessage(pipeline.error)} /> : !pipeline.data.items.length ? <Empty title="No applications here" description={tab === 'All' ? 'New applications appear here.' : 'Nothing is ' + tab.toLowerCase() + ' right now.'} /> :
        <div className="table-scroll"><table><thead><tr><th>Application</th><th>Student</th><th>Class</th><th>Status</th><th>Documents</th><th>Submitted</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{pipeline.data.items.map(r => <tr key={r.id}>
          <td>{r.applicationNumber || '—'}{r.admissionNumber ? <small> · {r.admissionNumber}</small> : null}</td><td><strong>{r.name}</strong>{r.duplicates > 0 && <span className="status-tag important adm-dup"><AlertTriangle size={12} />Possible duplicate</span>}<small className="muted"> · {r.guardianName}</small></td>
          <td>{r.className}</td><td><span className={'status-tag ' + statusTone(r.status)}>{r.status}</span></td><td>{docProgress(r.documents)}</td><td>{shortDate(r.submittedAt)}</td>
          <td><button className="button small secondary" onClick={() => open(r.id)}>Open</button></td></tr>)}</tbody></table></div>}
      <Pagination page={page} total={pipeline.data?.total || 0} size={25} onChange={setPage} /></section>
    {create && <ApplicationForm onClose={() => setCreate(false)} onSaved={id => { setCreate(false); open(id) }} />}
  </>
}

function ApplicationForm({ detail, onClose, onSaved }: { detail?: Detail, onClose: () => void, onSaved: (id: string) => void }) {
  const cache = useQueryClient(), options = useOptions(), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const catalog = useQuery<Module[]>({ queryKey: ['suite', 'catalog'], queryFn: () => data('/catalog') }), module = catalog.data?.find(m => m.kind === 'admissions')
  const form = useQuery<{ data: Row[] }>({ queryKey: ['suite', 'admission-fields', 'form'], queryFn: () => data('/records/admission-fields', { page: 1 }) })
  const questions: FormQuestion[] = detail?.form ?? (form.data?.data ?? []).filter(f => f.enabled === 'Yes' && f.type !== 'Document').sort((a, b) => Number(a.order) - Number(b.order)).map(f => ({ key: f.key, label: f.label, type: f.type, options: f.options || '', required: f.required === 'Yes' }))
  const fields = module?.fields.filter(f => !['status', 'admissionNumber', 'reviewNotes'].includes(f.key) || (f.key === 'reviewNotes' && !!detail)) ?? []
  async function save(e: FormEvent<HTMLFormElement>, submit: boolean) {
    e.preventDefault(); setBusy(true); setError('')
    const fd = new FormData(e.currentTarget), values: Record<string, unknown> = {}
    for (const f of fields) values[f.key] = String(fd.get(f.key) ?? '')
    values.answers = Object.fromEntries(questions.filter(q => q.type !== 'Document').map(q => [q.key, answerValue(q, fd)]))
    try {
      if (detail) { await client.put('/suite/records/admissions/' + detail.id, { ...detail.application, ...values, status: detail.status, version: detail.version }); await cache.invalidateQueries({ queryKey: ['suite', 'admissions'] }); onSaved(detail.id) }
      else { const r = await client.post('/suite/records/admissions', { ...values, status: submit ? 'Submitted' : 'Draft' }); await cache.invalidateQueries({ queryKey: ['suite', 'admissions'] }); onSaved(r.data.data.id) }
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  const submitIntent = useRef(false)
  return <Dialog title={detail ? 'Edit application' : 'New application'} onClose={() => !busy && onClose()}>{!module ? <Loading /> : <form onSubmit={e => save(e, submitIntent.current)}>{error && <ErrorBox message={error} />}
    <div className="form-grid">{fields.map(f => <SuiteInput key={f.key} field={f} options={options.data} value={detail?.application[f.key]} />)}
      {questions.map(q => <Question key={q.key} q={q} value={detail?.answers[q.key]} />)}</div>
    <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button>{detail ? <button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button> : <><button className="button secondary" disabled={busy} onClick={() => { submitIntent.current = false }}>Save draft</button><button className="button primary" disabled={busy} onClick={() => { submitIntent.current = true }}>{busy ? 'Saving…' : 'Submit application'}</button></>}</div></form>}</Dialog>
}

function Question({ q, value }: { q: FormQuestion, value?: unknown }) {
  const name = 'answer:' + q.key, label = <>{q.label}{!q.required && <span className="optional"> (optional)</span>}</>
  if (q.type === 'Paragraph') return <label className="full-width">{label}<textarea name={name} required={q.required} maxLength={2000} rows={3} defaultValue={String(value ?? '')} /></label>
  if (q.type === 'Dropdown') return <label>{label}<select name={name} required={q.required} defaultValue={String(value ?? '')}><option value="">Select…</option>{choices(q).map(c => <option key={c}>{c}</option>)}</select></label>
  if (q.type === 'Single choice' || q.type === 'Multiple choice') return <fieldset className="full-width adm-choices"><legend>{label}</legend>{choices(q).map(c => <label key={c} className="adm-check"><input type={q.type === 'Single choice' ? 'radio' : 'checkbox'} name={name} value={c} defaultChecked={Array.isArray(value) ? value.includes(c) : value === c} required={q.type === 'Single choice' && q.required} />{c}</label>)}</fieldset>
  if (q.type === 'Checkbox') return <label className="full-width adm-check"><input type="checkbox" name={name} defaultChecked={value === true} required={q.required} />{label}</label>
  return <label>{label}<input name={name} type={q.type === 'Number' ? 'number' : q.type === 'Date' ? 'date' : 'text'} required={q.required} maxLength={255} defaultValue={String(value ?? '')} /></label>
}

function ApplicationView({ id, back }: { id: string, back: () => void }) {
  const cache = useQueryClient(), user = useAuthStore(s => s.user), perms = { manage: !!user?.permissions.includes('admissions.manage'), approve: !!user?.permissions.includes('admissions.approve'), onboard: !!user?.permissions.includes('onboarding.manage') }
  const detail = useQuery<Detail>({ queryKey: ['suite', 'admissions', 'detail', id], queryFn: () => data('/admissions/' + id) })
  const [decision, setDecision] = useState<{ to: string, label: string, reason: boolean } | null>(null), [edit, setEdit] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function refresh(m: string) { setMessage(m); setError(''); await cache.invalidateQueries({ queryKey: ['suite', 'admissions'] }) }
  async function act(fn: () => Promise<unknown>, m: string) { setBusy(true); setError(''); try { await fn(); await refresh(m) } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) } }
  if (detail.isPending) return <Loading />
  if (detail.isError) return <><button className="button secondary" onClick={back}><ArrowLeft size={16} />All applications</button><ErrorBox message={errorMessage(detail.error)} /></>
  const d = detail.data, a = d.application, onboarding = d.status === 'Onboarding' || d.status === 'Ready'
  return <><PageHeader eyebrow={'APPLICATION ' + (d.applicationNumber || '')} title={d.name} description={(d.className || 'No class') + (d.yearName ? ' · ' + d.yearName : '') + ' · guardian ' + d.guardianName}>
    <button className="button secondary" onClick={back}><ArrowLeft size={16} />All applications</button>{perms.manage && editable(d.status) && <button className="button secondary" onClick={() => setEdit(true)}>Edit details</button>}</PageHeader>
    {error && <ErrorBox message={error} />}{message && <div className="success-box" role="status">{message}</div>}
    <section className="panel adm-panel"><div className="panel-heading"><div><h2><span className={'status-tag ' + statusTone(d.status)}>{d.status}</span></h2><p>{d.status === 'Approved' ? 'Approved. Start onboarding to prepare the student’s record.' : onboarding ? 'Onboarding ' + percent(d.onboarding) + '% complete' : d.status === 'Active' ? 'This student is active.' : 'Decide this application.'}</p></div>
      <div className="row-actions">{decisionsFor(d.status, perms).map(x => <button key={x.to} className={'button small ' + (x.primary ? 'primary' : 'secondary')} disabled={busy} onClick={() => setDecision(x)}>{x.label}</button>)}
        {d.status === 'Approved' && perms.onboard && <button className="button small primary" disabled={busy} onClick={() => act(() => client.post('/suite/admissions/' + id + '/onboarding/start'), 'Onboarding started.')}>Start onboarding</button>}
        {d.status === 'Active' && d.studentId && <Link className="button small primary" to={'/student360/' + d.studentId}>Open Student 360 <ArrowUpRight size={14} /></Link>}</div></div>
      {d.duplicates.length > 0 && !['Active', 'Rejected', 'Withdrawn'].includes(d.status) && <div className="info-box adm-warning" role="note"><AlertTriangle size={16} /> <strong>Possible duplicate{d.duplicates.length > 1 ? 's' : ''}.</strong> {d.duplicates.map(x => x.label + ' (' + (x.source === 'student' ? 'student ' : 'application ') + (x.number || '') + ': ' + x.reasons.join(', ') + ')').join('; ')}. Nothing is merged automatically.</div>}
    </section>
    {onboarding && <Onboarding d={d} perms={perms} onDone={refresh} onError={setError} />}
    <div className="dashboard-grid">
      <section className="panel adm-panel"><div className="panel-heading"><div><h2>Application</h2><p>Submitted {shortDate(d.submittedAt)}</p></div></div>
        <dl className="record-details">{([['Date of birth', a.dateOfBirth], ['Gender', a.gender], ['Student email', a.email], ['Student phone', a.phoneNumber], ['Previous school', a.previousSchool], ['Guardian', a.guardianName + (a.guardianRelationship ? ' (' + a.guardianRelationship + ')' : '')], ['Guardian email', a.guardianEmail], ['Guardian phone', a.guardianPhone], ['Address', a.address], ['Source', a.source], ['Applicant notes', a.notes], ['Internal review notes', a.reviewNotes]] as [string, string][]).filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          {d.form.filter(q => q.type !== 'Document' && d.answers[q.key] !== undefined && d.answers[q.key] !== '').map(q => <div key={q.key}><dt>{q.label}</dt><dd>{Array.isArray(d.answers[q.key]) ? (d.answers[q.key] as string[]).join(', ') : typeof d.answers[q.key] === 'boolean' ? (d.answers[q.key] ? 'Yes' : 'No') : String(d.answers[q.key])}</dd></div>)}</dl></section>
      <section className="panel adm-panel"><div className="panel-heading"><div><h2>History</h2><p>Every decision with who made it</p></div></div>
        <ul className="dash-list">{[...d.history].reverse().map((h, i) => <li key={i}><span className="stat-icon teal"><Check size={15} /></span><div><strong>{h.from ? h.from + ' → ' : ''}{h.to}</strong><small>{h.at.slice(0, 16).replace('T', ' ')}{h.reason ? ' · ' + h.reason : ''}</small></div></li>)}</ul></section>
    </div>
    {!onboarding && d.status !== 'Active' && <section className="panel adm-panel"><Attachments recordId={id} canUpload={perms.manage && editable(d.status)} /></section>}
    {decision && <DecisionDialog d={d} decision={decision} onClose={() => setDecision(null)} onDone={async m => { setDecision(null); await refresh(m) }} />}
    {edit && <ApplicationForm detail={d} onClose={() => setEdit(false)} onSaved={async () => { setEdit(false); await refresh('Application saved.') }} />}
  </>
}

function DecisionDialog({ d, decision, onClose, onDone }: { d: Detail, decision: { to: string, label: string, reason: boolean }, onClose: () => void, onDone: (m: string) => void }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [ack, setAck] = useState(false), needsAck = decision.to === 'Approved' && d.duplicates.length > 0
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError('')
    try { await client.post('/suite/admissions/' + d.id + '/transition', { to: decision.to, reason: String(new FormData(e.currentTarget).get('reason') ?? ''), version: d.version, acknowledgeDuplicates: ack }); onDone(decision.label + ': done.') } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return <Dialog title={decision.label + ' · ' + d.name} onClose={() => !busy && onClose()}><form onSubmit={save}>{error && <ErrorBox message={error} />}
    <label className="full-width">{decision.reason ? 'Reason' : 'Note (optional)'}<textarea name="reason" required={decision.reason} maxLength={1000} rows={3} /></label>
    {needsAck && <label className="adm-check full-width"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />I reviewed the possible duplicates and this is a different child.</label>}
    <p className="muted">Reasons are kept in the application history for the school office. They are not shown to the family.</p>
    <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || (needsAck && !ack)}>{busy ? 'Saving…' : decision.label}</button></div></form></Dialog>
}

function Onboarding({ d, perms, onDone, onError }: { d: Detail, perms: { onboard: boolean }, onDone: (m: string) => Promise<void>, onError: (m: string) => void }) {
  const c = d.onboarding, [step, setStep] = useState<string>(nextStep(c.steps)), [busy, setBusy] = useState(false)
  async function put(body: Record<string, unknown>, m: string) { setBusy(true); try { await client.put('/suite/admissions/' + d.id + '/onboarding', { ...body, version: d.version }); await onDone(m) } catch (e) { onError(errorMessage(e)) } finally { setBusy(false) } }
  async function activate() { if (!window.confirm('Activate ' + d.name + '? The guardian, student, class place, fee charges and account links are created together.')) return; setBusy(true); try { await client.post('/suite/admissions/' + d.id + '/activate'); await onDone('Student activated.') } catch (e) { onError(errorMessage(e)) } finally { setBusy(false) } }
  const stepOf = (key: string) => c.steps.find(s => s.key === key)
  const nav: [string, string, Step | undefined][] = [['details', 'Applicant', stepOf('details')], ['guardian', 'Guardian', stepOf('guardian')], ['documents', 'Documents', stepOf('documents')], ['academics', 'Academics', stepOf('academics')], ['fees', 'Fees', stepOf('fees')], ['accounts', 'Accounts', stepOf('accounts')], ['review', 'Review & activate', undefined]]
  return <section className="panel adm-panel adm-onboarding"><div className="panel-heading"><div><h2>Onboarding</h2><p>{c.done} of {c.total} steps complete{c.blockers.length ? ' · ' + c.blockers.length + ' blocking activation' : ' · ready to activate'}</p></div></div>
    <ol className="adm-steps">{nav.map(([key, label, s]) => <li key={key}><button className={'adm-step' + (step === key ? ' current' : '') + (s?.done ? ' done' : '')} aria-current={step === key ? 'step' : undefined} onClick={() => setStep(key)}><span className="adm-dot" aria-hidden="true">{s?.done ? <Check size={13} /> : ''}</span>{label}{s && !s.required && <small> (optional)</small>}</button></li>)}</ol>
    <div className="adm-step-body">
      {step === 'details' && <DetailsStep d={d} busy={busy || !perms.onboard} put={put} />}
      {step === 'guardian' && <GuardianStep d={d} busy={busy || !perms.onboard} put={put} />}
      {step === 'documents' && <DocumentsStep d={d} busy={busy || !perms.onboard} put={put} />}
      {step === 'academics' && <AcademicsStep d={d} busy={busy || !perms.onboard} put={put} />}
      {step === 'fees' && <FeesStep d={d} busy={busy || !perms.onboard} put={put} />}
      {step === 'accounts' && <AccountsStep d={d} busy={busy || !perms.onboard} put={put} onError={onError} />}
      {step === 'review' && <div><h3>Review</h3>{c.blockers.length ? <><p>Activation is blocked by:</p><ul className="adm-blockers">{c.blockers.map(b => <li key={b}>{b}</li>)}</ul></> : <p>Everything required is in place. Activation creates the student in {c.academics.className}{c.fees.mode === 'assign' ? ', issues ' + c.fees.structures.length + ' fee charge(s) totalling ' + c.fees.total.toLocaleString('en-IN') : ''}{(c.accounts.parentUserId || c.accounts.studentUserId) ? ' and links the chosen accounts' : ''}.</p>}
        <button className="button primary" disabled={busy || !perms.onboard || c.blockers.length > 0 || d.status !== 'Ready'} onClick={activate}>Activate student</button></div>}
    </div></section>
}
type StepProps = { d: Detail, busy: boolean, put: (body: Record<string, unknown>, m: string) => Promise<void> }
function DetailsStep({ d, busy, put }: StepProps) {
  const [confirmed, setConfirmed] = useState(d.onboarding.detailsConfirmed), [number, setNumber] = useState(d.admissionNumber)
  return <div><h3>Applicant</h3><p className="muted">Check the student’s details on the application, then confirm them. The admission number is assigned now or, if left empty, from the school’s series at activation.</p>
    <div className="form-grid"><label>Admission number <span className="optional">(optional)</span><input value={number} maxLength={50} onChange={e => setNumber(e.target.value)} /></label><label className="adm-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />The student’s details are correct</label></div>
    <button className="button primary" disabled={busy} onClick={() => put({ section: 'details', confirmed, admissionNumber: number }, 'Applicant details saved.')}>Save</button></div>
}
function GuardianStep({ d, busy, put }: StepProps) {
  const g = d.onboarding.guardian, candidates = useQuery<{ guardians: Row[], users: Row[] }>({ queryKey: ['suite', 'admissions', 'candidates', d.id], queryFn: () => data('/admissions/' + d.id + '/candidates') })
  const [mode, setMode] = useState(g.mode || 'new'), [parentId, setParentId] = useState(g.parentId), [relationship, setRelationship] = useState(g.relationship || ''), [confirmed, setConfirmed] = useState(g.confirmed)
  return <div><h3>Guardian</h3><p className="muted">A guardian already on file can be linked only when their email or phone is the one on the application. Otherwise a new guardian is created from the application at activation.</p>
    {candidates.isPending ? <Loading /> : <div className="adm-options" role="radiogroup" aria-label="Guardian">
      {(candidates.data?.guardians ?? []).map(p => <label key={p.id} className="adm-option"><input type="radio" name="guardian" checked={mode === 'existing' && parentId === p.id} onChange={() => { setMode('existing'); setParentId(p.id) }} /><span><strong>{p.name}</strong><small>{p.email} · {p.phone || 'no phone'} · {p.children} child(ren) at the school</small></span></label>)}
      <label className="adm-option"><input type="radio" name="guardian" checked={mode === 'new'} onChange={() => { setMode('new'); setParentId('') }} /><span><strong>New guardian: {d.application.guardianName}</strong><small>{d.application.guardianEmail} · {d.application.guardianPhone}</small></span></label></div>}
    <div className="form-grid"><label>Relationship<select aria-label="Relationship" value={relationship} onChange={e => setRelationship(e.target.value)}><option value="">Select…</option>{RELATIONSHIPS.map(r => <option key={r}>{r}</option>)}</select></label><label className="adm-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />The guardian and relationship are confirmed</label></div>
    <button className="button primary" disabled={busy || !relationship} onClick={() => put({ section: 'guardian', mode, parentId, relationship, confirmed }, 'Guardian saved.')}>Save</button></div>
}
function DocumentsStep({ d, busy, put }: StepProps) {
  const [notes, setNotes] = useState<Record<string, string>>({})
  return <div><h3>Documents</h3><p className="muted">Upload the documents to this application, then mark each one. Files stay inside your school workspace.</p>
    <div className="table-scroll"><table><thead><tr><th>Document</th><th>Status</th><th>Note</th><th>Action</th></tr></thead><tbody>{d.onboarding.documents.map(doc => <tr key={doc.key}><td>{doc.label}{doc.required ? '' : <small className="muted"> (optional)</small>}</td><td><span className={'status-tag ' + (doc.status === 'Verified' ? 'active' : doc.status === 'Rejected' ? 'important' : '')}>{doc.status}</span></td>
      <td><input aria-label={'Note for ' + doc.label} value={notes[doc.key] ?? doc.note} maxLength={500} onChange={e => setNotes({ ...notes, [doc.key]: e.target.value })} /></td>
      <td><div className="row-actions">{(['Verified', 'Rejected', 'Not applicable'] as const).map(st => <button key={st} className="button small secondary" disabled={busy} onClick={() => put({ section: 'documents', key: doc.key, status: st, note: notes[doc.key] ?? doc.note }, doc.label + ': ' + st.toLowerCase() + '.')}>{st === 'Verified' ? 'Verify' : st === 'Rejected' ? 'Needs replacement' : 'Not applicable'}</button>)}</div></td></tr>)}</tbody></table></div>
    <Attachments recordId={d.id} canUpload={!busy} /><p className="sr-only">{DOCUMENT_STATUSES.join(', ')}</p></div>
}
function AcademicsStep({ d, busy, put }: StepProps) {
  const options = useOptions(), [classId, setClassId] = useState(d.onboarding.academics.classId)
  return <div><h3>Academics</h3><p className="muted">The class and section the student joins. Its free places are checked again at activation.</p>
    <div className="form-grid"><label>Class and section<select aria-label="Class and section" value={classId} onChange={e => setClassId(e.target.value)}><option value="">Select…</option>{options.data?.classes?.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label></div>
    <button className="button primary" disabled={busy || !classId} onClick={() => put({ section: 'academics', classId }, 'Class saved.')}>Save</button></div>
}
function FeesStep({ d, busy, put }: StepProps) {
  const f = d.onboarding.fees, classId = d.onboarding.academics.classId
  const structures = useQuery<Row[]>({ queryKey: ['suite', 'fee-structures', 'class', classId], enabled: !!classId, queryFn: async () => { const rows: Row[] = []; for (let page = 1; page <= 10; page++) { const r = await data<{ data: Row[], totalCount: number }>('/records/fee-structures', { page }); rows.push(...r.data); if (!r.data.length || rows.length >= r.totalCount) break } return rows.filter(s => s.classId === classId && !s.studentId) } })
  const [mode, setMode] = useState(f.mode || 'assign'), [chosen, setChosen] = useState<string[]>(f.structures.map(s => s.id)), [reason, setReason] = useState(f.reason)
  return <div><h3>Fees</h3><p className="muted">Choose the class’s fee structures to charge at activation, or record why none apply. Amounts come from the structures; concessions are given in Fees after activation.</p>
    {!classId ? <p>Choose the class first.</p> : <>
      <div className="adm-options" role="radiogroup" aria-label="Fees"><label className="adm-option"><input type="radio" name="feemode" checked={mode === 'assign'} onChange={() => setMode('assign')} /><span><strong>Charge fee structures</strong></span></label><label className="adm-option"><input type="radio" name="feemode" checked={mode === 'none'} onChange={() => setMode('none')} /><span><strong>No fees apply now</strong></span></label></div>
      {mode === 'assign' ? structures.isPending ? <Loading /> : !structures.data?.length ? <p>No fee structures exist for this class yet.</p> : <div className="adm-options">{structures.data.map(s => <label key={s.id} className="adm-option"><input type="checkbox" checked={chosen.includes(s.id)} onChange={e => setChosen(e.target.checked ? [...chosen, s.id] : chosen.filter(x => x !== s.id))} /><span><strong>{s.name} · {s.installment}</strong><small>{Number(s.amount).toLocaleString('en-IN')} due {String(s.dueDate).slice(0, 10)}</small></span></label>)}</div>
        : <label className="full-width">Reason<input value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label>}
      {f.mode === 'assign' && f.structures.length > 0 && <p className="muted">Planned: {f.structures.length} charge(s), {f.total.toLocaleString('en-IN')} in total.</p>}
      <button className="button primary" disabled={busy || (mode === 'assign' ? !chosen.length : !reason.trim())} onClick={() => put(mode === 'assign' ? { section: 'fees', mode, structureIds: chosen } : { section: 'fees', mode, reason }, 'Fees saved.')}>Save</button></>}</div>
}
function AccountsStep({ d, busy, put, onError }: StepProps & { onError: (m: string) => void }) {
  const cache = useQueryClient(), user = useAuthStore(s => s.user), mayCreate = !!user?.permissions.includes('users.create') && !!user?.permissions.includes('roles.assign')
  const candidates = useQuery<{ guardians: Row[], users: Row[] }>({ queryKey: ['suite', 'admissions', 'candidates', d.id], queryFn: () => data('/admissions/' + d.id + '/candidates') })
  const [parentUserId, setParent] = useState(d.onboarding.accounts.parentUserId ?? ''), [studentUserId, setStudent] = useState(d.onboarding.accounts.studentUserId ?? ''), [code, setCode] = useState<{ who: string, code: string } | null>(null), [working, setWorking] = useState(false)
  const users = candidates.data?.users ?? []
  async function provision(scope: 'parent' | 'student') {
    setWorking(true)
    try {
      // The existing account system: a role of the school, a password nobody sees, and a one-time code the person uses to set their own.
      const roles = (await client.get('/roles', { params: { schoolId: user?.schoolId } })).data.data as { id: string, name: string }[]
      const role = roles.find(r => r.name === (scope === 'parent' ? 'Parent' : 'Student')); if (!role) throw new Error('The school has no ' + scope + ' role.')
      const a = d.application, email = scope === 'parent' ? a.guardianEmail : a.email, [first, ...rest] = (scope === 'parent' ? a.guardianName : a.firstName + ' ' + a.lastName).split(' ')
      const created = await client.post('/users', { schoolId: user?.schoolId, roleId: role.id, username: email, email, firstName: first, lastName: rest.join(' ') || (scope === 'parent' ? 'Guardian' : a.lastName), password: hiddenPassword() })
      const recovery = await client.post('/users/' + created.data.data.id + '/recovery-code', undefined, { params: { schoolId: user?.schoolId } }); setCode({ who: email, code: recovery.data.data.code })
      if (scope === 'parent') setParent(created.data.data.id); else setStudent(created.data.data.id)
      await cache.invalidateQueries({ queryKey: ['suite', 'admissions', 'candidates', d.id] })
    } catch (e) { onError(errorMessage(e)) } finally { setWorking(false) }
  }
  return <div><h3>Accounts</h3><p className="muted">Optional. Link the family’s accounts now so they can sign in once the student is active. Only accounts whose email matches the application can be linked; links are made at activation.</p>
    {candidates.isPending ? <Loading /> : <div className="form-grid">
      <label>Parent account<select value={parentUserId} onChange={e => setParent(e.target.value)}><option value="">None yet</option>{users.filter(u => u.scope === 'parent').map(u => <option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}</select></label>
      <label>Student account<select value={studentUserId} onChange={e => setStudent(e.target.value)}><option value="">None yet</option>{users.filter(u => u.scope === 'student').map(u => <option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}</select></label></div>}
    {mayCreate && <div className="row-actions">{!users.some(u => u.scope === 'parent') && <button className="button small secondary" disabled={working || busy} onClick={() => provision('parent')}><UserPlus size={14} />Create parent account</button>}{!users.some(u => u.scope === 'student') && <button className="button small secondary" disabled={working || busy} onClick={() => provision('student')}><UserPlus size={14} />Create student account</button>}</div>}
    {code && <div className="info-box" role="status">Account created for {code.who}. One-time sign-in code (valid 15 minutes, shown once): <code className="adm-code">{code.code}</code>. Share it privately; no email or SMS was sent.</div>}
    <button className="button primary" disabled={busy} onClick={() => put({ section: 'accounts', parentUserId, studentUserId }, 'Accounts saved.')}>Save</button></div>
}
