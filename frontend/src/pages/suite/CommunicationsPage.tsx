import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, ArrowLeft, Check, AlertTriangle, Megaphone, Clock } from 'lucide-react'
import client, { errorMessage } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { Dialog, Empty, ErrorBox, Loading, PageHeader, Pagination } from '../../components/UI'
import { data, type Options } from './helpers'
import { Attachments } from './SuitePage'
import { type Acknowledgements, type Attention, type Composition, type Detail, type Feed, type FeedItem, type Perms, type Status, type Workspace, STATUSES, STEPS, TYPES, actionsFor, attentionLines, audienceOptions, composeProblems, editableFields, emptyComposition, feedOrder, fromDetail, priorityOptions, priorityTone, progress, recordBody, scheduleIso, shortWhen, statusTone, whenLabel } from './communications'

// Communication 2.0: one workspace for school communications. Leadership (and a teacher given the permission) composes,
// publishes or schedules, and reads what happened; everyone else reads what was addressed to them and acknowledges
// where asked. Every audience, status and figure comes from the server.
export default function CommunicationsPage() {
  const user = useAuthStore(s => s.user)
  const perms: Perms = { manage: !!user?.permissions.includes('circulars.manage'), schoolWide: user?.dataScope === 'school', acknowledge: !!user?.permissions.includes('circulars.acknowledge') }
  const [params, setParams] = useSearchParams(), id = params.get('id')
  const open = (next: string | null) => setParams(p => { if (next) p.set('id', next); else p.delete('id'); return p })
  if (!perms.manage) return <FeedView perms={perms} />
  return id ? <DetailView id={id} perms={perms} back={() => open(null)} /> : <WorkspaceView perms={perms} open={open} />
}
const useOptions = () => useQuery<Options>({ queryKey: ['suite', 'options'], queryFn: () => data('/options') })
const Tag = ({ item }: { item: { type: string, priority: string } }) => <span className="com-tags"><span className="status-tag">{item.type}</span>{item.priority !== 'Normal' && <span className={'status-tag ' + priorityTone(item.priority)}>{item.priority}</span>}</span>

function WorkspaceView({ perms, open }: { perms: Perms, open: (id: string) => void }) {
  const [tab, setTab] = useState<Status>('Published'), [page, setPage] = useState(1), [compose, setCompose] = useState(false)
  const list = useQuery<Workspace>({ queryKey: ['suite', 'communications', tab, page], queryFn: () => data('/communications', { status: tab, page }) })
  const attention = useQuery<Attention>({ queryKey: ['suite', 'communications', 'attention'], enabled: perms.schoolWide, queryFn: () => data('/communications/attention') })
  return <><PageHeader eyebrow="COMMUNICATION" title="Communications" description="Notices, circulars and announcements to the right people, with what happened to each one.">
    <button className="button primary" onClick={() => setCompose(true)}><Plus size={17} />New communication</button></PageHeader>
    {perms.schoolWide && attention.data && <section className="panel com-panel" aria-label="Needs attention"><div className="panel-heading"><div><h2>What needs attention</h2><p>Scheduled, urgent, awaiting acknowledgement and delivery problems</p></div></div>
      <ul className="com-attention">{attentionLines(attention.data).map(l => <li key={l.key}><strong className={l.tone ? 'tone-' + l.tone : ''}>{l.count}</strong><span>{l.label}</span></li>)}</ul>
      {attention.data.outstanding.length > 0 && <ul className="dash-list com-list">{attention.data.outstanding.slice(0, 5).map(i => <li key={i.id}><span className="stat-icon peach"><AlertTriangle size={15} /></span><div><strong>{i.title}</strong><small>{i.audienceLabel} · {i.counts.outstanding} still to acknowledge</small></div><button className="button small secondary" onClick={() => open(i.id)}>Open</button></li>)}</ul>}
      <p className="com-note muted">In-app delivery only: {attention.data.deliveries.channels.join(', ')}. Push, email, SMS and WhatsApp are not switched on.</p></section>}
    <div className="module-tabs" role="tablist">{STATUSES.map(s => <a key={s} href="#" role="tab" aria-selected={tab === s} className={tab === s ? 'selected' : ''} onClick={e => { e.preventDefault(); setTab(s); setPage(1) }}>{s}{list.data ? ' · ' + (list.data.counts[s] ?? 0) : ''}</a>)}</div>
    <section className="panel com-panel"><div className="directory-toolbar"><div><h2>{tab}</h2><p>{list.data?.total ?? 0} communication(s)</p></div></div>
      {list.isPending ? <Loading /> : list.isError ? <ErrorBox message={errorMessage(list.error)} /> : !list.data.items.length ? <Empty title={'Nothing ' + tab.toLowerCase()} description={tab === 'Draft' ? 'Start a new communication and save it as a draft.' : 'Communications appear here as their status changes.'} /> :
        <div className="table-scroll"><table><thead><tr><th>Communication</th><th>Audience</th><th>When</th><th>Progress</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{list.data.items.map(i => <tr key={i.id}>
          <td><strong>{i.title}</strong><Tag item={i} /></td><td>{i.audienceLabel}</td><td>{whenLabel(i)}</td><td>{i.status === 'Published' ? progress(i.counts, i.requiresAcknowledgement) : '—'}</td>
          <td><button className="button small secondary" onClick={() => open(i.id)}>Open</button></td></tr>)}</tbody></table></div>}
      <Pagination page={page} total={list.data?.total || 0} size={25} onChange={setPage} /></section>
    {compose && <ComposeDialog perms={perms} onClose={() => setCompose(false)} onSaved={id => { setCompose(false); open(id) }} />}
  </>
}

function DetailView({ id, perms, back }: { id: string, perms: Perms, back: () => void }) {
  const cache = useQueryClient(), detail = useQuery<Detail>({ queryKey: ['suite', 'communications', 'detail', id], queryFn: () => data('/communications/' + id) })
  const [acting, setActing] = useState<{ action: string, label: string, reason?: boolean, time?: boolean } | null>(null), [edit, setEdit] = useState(false), [people, setPeople] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  async function refresh(m: string) { setMessage(m); setError(''); await cache.invalidateQueries({ queryKey: ['suite', 'communications'] }) }
  if (detail.isPending) return <Loading />
  if (detail.isError) return <><button className="button secondary" onClick={back}><ArrowLeft size={16} />All communications</button><ErrorBox message={errorMessage(detail.error)} /></>
  const d = detail.data
  return <><PageHeader eyebrow={d.type.toUpperCase()} title={d.title} description={d.audienceLabel + ' · ' + whenLabel(d)}>
    <button className="button secondary" onClick={back}><ArrowLeft size={16} />All communications</button>{editableFields(d.status).length > 0 && <button className="button secondary" onClick={() => setEdit(true)}>Edit</button>}</PageHeader>
    {error && <ErrorBox message={error} />}{message && <div className="success-box" role="status">{message}</div>}
    <section className="panel com-panel"><div className="panel-heading"><div><h2><span className={'status-tag ' + statusTone(d.status)}>{d.status}</span> <Tag item={d} /></h2><p>{d.status === 'Published' ? progress(d.counts, d.requiresAcknowledgement) : d.status === 'Scheduled' ? 'Goes out ' + shortWhen(d.publishAt) + ' to ' + d.audienceLabel.toLowerCase() : d.status === 'Cancelled' ? 'Cancelled' + (d.cancelReason ? ': ' + d.cancelReason : '') : 'Only you and school leadership can see this.'}</p></div>
      <div className="row-actions">{actionsFor(d.status, perms).map(x => <button key={x.action} className={'button small ' + (x.primary ? 'primary' : 'secondary')} onClick={() => setActing(x)}>{x.label}</button>)}</div></div>
      <div className="com-message">{d.message}</div>
      {d.requiresAcknowledgement && <p className="com-note">Acknowledgement required{d.acknowledgeBy ? ' by ' + d.acknowledgeBy : ''}.</p>}{d.expiresOn && <p className="com-note">Expires on {d.expiresOn}{d.expired ? ' (expired)' : ''}.</p>}
    </section>
    {d.status === 'Published' && <div className="stats-grid com-counts">{([['Intended', d.counts.intended, d.snapshot ? 'at publication' : 'notified'], ['Notified', d.counts.notified, 'in-app inbox'], ['Read', d.counts.read, 'opened it'], [d.requiresAcknowledgement ? 'Outstanding' : 'Acknowledged', d.requiresAcknowledgement ? d.counts.outstanding ?? 0 : d.counts.acknowledged, d.requiresAcknowledgement ? d.counts.acknowledged + ' acknowledged' : 'optional']] as [string, number, string][]).map(([k, v, note]) => <div key={k} className="stat-card"><strong>{v}</strong><h3>{k}</h3><p>{note}</p></div>)}</div>}
    <div className="dashboard-grid">
      <section className="panel com-panel"><div className="panel-heading"><div><h2>History</h2><p>Every status move with who made it</p></div></div>
        <ul className="dash-list">{[...d.history].reverse().map((h, i) => <li key={i}><span className="stat-icon teal"><Check size={15} /></span><div><strong>{h.from ? h.from + ' → ' : ''}{h.to}</strong><small>{shortWhen(h.at)}{h.reason ? ' · ' + h.reason : ''}</small></div></li>)}</ul>
        {d.snapshot && <p className="com-note muted">Audience at publication: {d.snapshot.audience}, {d.snapshot.count} people ({shortWhen(d.snapshot.at)}). Later class changes do not rewrite this.</p>}</section>
      <section className="panel com-panel"><div className="panel-heading"><div><h2>Recipients</h2><p>Names and kind of account only</p></div>{d.status === 'Published' && <button className="button small secondary" aria-expanded={people} onClick={() => setPeople(!people)}>{people ? 'Hide' : 'Who has not acknowledged'}</button>}</div>
        {people ? <People id={id} /> : <Attachments recordId={id} canUpload={editableFields(d.status).length > 0} />}</section>
    </div>
    {acting && <ActionDialog d={d} act={acting} onClose={() => setActing(null)} onDone={async m => { setActing(null); await refresh(m) }} />}
    {edit && <ComposeDialog perms={perms} detail={d} onClose={() => setEdit(false)} onSaved={async () => { setEdit(false); await refresh('Saved.') }} />}
  </>
}
function People({ id }: { id: string }) {
  const list = useQuery<Acknowledgements>({ queryKey: ['suite', 'communications', 'ack', id], queryFn: () => data('/communications/' + id + '/acknowledgements') })
  if (list.isPending) return <Loading />; if (list.isError) return <ErrorBox message={errorMessage(list.error)} />
  const a = list.data
  return <div className="com-people"><p className="com-note">{a.intended} intended · {a.acknowledged.length} acknowledged · {a.outstanding.length} outstanding</p>
    {a.outstanding.length > 0 && <div className="table-scroll"><table><thead><tr><th>Person</th><th>Account</th><th>Read</th></tr></thead><tbody>{a.outstanding.map((p, i) => <tr key={i}><td>{p.name}</td><td>{p.scope}</td><td>{p.read ? 'Read' : 'Unread'}</td></tr>)}</tbody></table></div>}
    {a.acknowledged.length > 0 && <details><summary>Acknowledged ({a.acknowledged.length})</summary><ul className="com-ack">{a.acknowledged.map((p, i) => <li key={i}>{p.name} · {p.scope} · {shortWhen(p.at)}</li>)}</ul></details>}</div>
}
function ActionDialog({ d, act, onClose, onDone }: { d: Detail, act: { action: string, label: string, reason?: boolean, time?: boolean }, onClose: () => void, onDone: (m: string) => void }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [reason, setReason] = useState(''), [when, setWhen] = useState('')
  async function go() {
    setBusy(true); setError('')
    try { const r = await client.post('/suite/communications/' + d.id + '/' + act.action, { version: d.version, reason, publishAt: act.time ? scheduleIso(when) : undefined }); onDone(r.data.message || act.label + ': done.') } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  return <Dialog title={act.label + ' · ' + d.title} onClose={() => !busy && onClose()}>{error && <ErrorBox message={error} />}
    {act.time && <label className="full-width">Publish at<input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} /></label>}
    {act.reason && <label className="full-width">Reason<textarea value={reason} maxLength={500} rows={3} onChange={e => setReason(e.target.value)} /></label>}
    {act.action === 'publish' && <p className="modal-copy">Publishing resolves the audience now ({d.audienceLabel.toLowerCase()}) and places one notification in each person’s inbox. It cannot be unsent; it can be archived.</p>}
    {act.action === 'archive' && <p className="modal-copy">Archiving keeps the communication and its history. It stays readable to the people it was sent to, as history.</p>}
    <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Back</button><button className="button primary" disabled={busy || (act.reason && !reason.trim()) || (act.time && !when)} onClick={go}>{busy ? 'Working…' : act.label}</button></div></Dialog>
}

/** Compose: Message → Audience → Delivery → Review, then save as draft, publish now or schedule. Editing reuses it with the frozen fields disabled. */
function ComposeDialog({ perms, detail, onClose, onSaved }: { perms: Perms, detail?: Detail, onClose: () => void, onSaved: (id: string) => void }) {
  const options = useOptions(), cache = useQueryClient(), user = useAuthStore(s => s.user)
  const [c, setC] = useState<Composition>(detail ? fromDetail(detail) : { ...emptyComposition(), audience: perms.schoolWide ? 'All' : 'Parent' }), [step, setStep] = useState(0), [error, setError] = useState(''), [busy, setBusy] = useState(false), [count, setCount] = useState<{ count: number, label: string } | null>(null)
  const set = (patch: Partial<Composition>) => { setC(prev => ({ ...prev, ...patch })); setCount(null) }
  const allowed = detail ? editableFields(detail.status) : null, can = (field: string) => !allowed || allowed.includes(field)
  // Classes shown are those the options call already limits to the person's scope; a teacher's list is their own classes.
  const classes = options.data?.classes ?? [], problems = composeProblems(c, perms)
  useEffect(() => { if (step !== 3 || detail) return; let live = true
    client.post('/suite/communications/audience', { audience: c.audience, classId: c.classId }).then(r => { if (live) setCount(r.data.data) }).catch(e => { if (live) setError(errorMessage(e)) })
    return () => { live = false } }, [step, c.audience, c.classId, detail])
  async function save() {
    setBusy(true); setError('')
    try {
      if (detail) { await client.put('/suite/records/circulars/' + detail.id, { ...recordBody({ ...c, when: detail.status === 'Scheduled' ? 'schedule' : detail.status === 'Published' ? 'now' : 'draft' }), status: detail.status, publishAt: detail.status === 'Scheduled' ? scheduleIso(c.publishAt) : detail.publishAt, version: detail.version }); onSaved(detail.id) }
      else { const r = await client.post('/suite/records/circulars', recordBody(c)); await cache.invalidateQueries({ queryKey: ['suite', 'communications'] }); onSaved(r.data.data.id) }
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  const needsClass = !perms.schoolWide, title = detail ? 'Edit communication' : 'New communication'
  return <Dialog title={title} onClose={() => !busy && onClose()}>
    <ol className="adm-steps com-steps">{STEPS.map((s, i) => <li key={s}><button type="button" className={'adm-step' + (step === i ? ' current' : '') + (i < step ? ' done' : '')} aria-current={step === i ? 'step' : undefined} onClick={() => setStep(i)}><span className="adm-dot" aria-hidden="true">{i < step ? <Check size={13} /> : ''}</span>{s}</button></li>)}</ol>
    {error && <ErrorBox message={error} />}
    {step === 0 && <div className="form-stack"><label>Title<input value={c.title} maxLength={255} disabled={!can('title')} onChange={e => set({ title: e.target.value })} /></label>
      <label>Message<textarea value={c.message} maxLength={4000} rows={6} disabled={!can('message')} onChange={e => set({ message: e.target.value })} /></label>
      <label>Type<select aria-label="Type" value={c.type} disabled={!can('type')} onChange={e => set({ type: e.target.value })}>{TYPES.map(t => <option key={t}>{t}</option>)}</select></label></div>}
    {step === 1 && <div className="form-stack"><label>Audience<select aria-label="Audience" value={c.audience} disabled={!can('audience')} onChange={e => set({ audience: e.target.value })}>{audienceOptions(perms).map(a => <option key={a.key} value={a.key}>{a.label}</option>)}</select></label>
      <label>Class{needsClass ? '' : <span className="optional"> (optional: narrows the audience to one class)</span>}<select aria-label="Class" value={c.classId} disabled={!can('classId')} onChange={e => set({ classId: e.target.value })}><option value="">{needsClass ? 'Choose a class…' : 'Whole school'}</option>{classes.map(cl => <option key={cl.id} value={cl.id}>{cl.label}</option>)}</select></label>
      <p className="muted">The server resolves the people from their roles and reviewed account links when the communication is published. Nobody outside your school can be addressed.</p></div>}
    {step === 2 && <div className="form-stack"><label>Priority<select aria-label="Priority" value={c.priority} disabled={!can('priority')} onChange={e => set({ priority: e.target.value })}>{priorityOptions(perms).map(p => <option key={p}>{p}</option>)}</select><small>Urgent communications reach everyone addressed even if they muted notices; the inbox title says Urgent.</small></label>
      <label className="adm-check"><input type="checkbox" checked={c.requiresAcknowledgement} disabled={!can('requiresAcknowledgement')} onChange={e => set({ requiresAcknowledgement: e.target.checked })} />Ask each recipient to acknowledge</label>
      {c.requiresAcknowledgement && <label>Acknowledge by<span className="optional"> (optional)</span><input type="date" value={c.acknowledgeBy} disabled={!can('acknowledgeBy')} onChange={e => set({ acknowledgeBy: e.target.value })} /></label>}
      <label>Expires on<span className="optional"> (optional)</span><input type="date" value={c.expiresOn} disabled={!can('expiresOn')} onChange={e => set({ expiresOn: e.target.value })} /></label>
      {!detail && <fieldset className="adm-choices com-when"><legend>Delivery</legend>{([['now', 'Publish now'], ['schedule', 'Schedule for later'], ['draft', 'Save as draft']] as const).map(([k, l]) => <label key={k} className="adm-check"><input type="radio" name="when" checked={c.when === k} onChange={() => set({ when: k })} />{l}</label>)}</fieldset>}
      {(c.when === 'schedule' && (!detail || detail.status === 'Scheduled')) && <label>Publish at<input type="datetime-local" value={c.publishAt} onChange={e => set({ publishAt: e.target.value })} /></label>}</div>}
    {step === 3 && <div className="form-stack com-review"><h3>{c.title || 'Untitled'}</h3><Tag item={c} /><div className="com-message">{c.message}</div>
      <dl className="record-details"><div><dt>Audience</dt><dd>{count ? count.label + ' · ' + count.count + ' people' : detail ? detail.audienceLabel : 'Counting…'}</dd></div><div><dt>Delivery</dt><dd>{c.when === 'now' ? 'Publish now: in-app inbox, once per person' : c.when === 'schedule' ? 'Scheduled for ' + (c.publishAt ? shortWhen(scheduleIso(c.publishAt)) : '—') : 'Saved as a draft; nobody is told'}</dd></div>{c.requiresAcknowledgement && <div><dt>Acknowledgement</dt><dd>Required{c.acknowledgeBy ? ' by ' + c.acknowledgeBy : ''}</dd></div>}</dl>
      {problems.length > 0 && <ul className="adm-blockers" role="alert">{problems.map(p => <li key={p}>{p}</li>)}</ul>}
      <p className="muted">Signed in as {user?.firstName}. Publication is recorded in the activity log.</p></div>}
    <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={step === 0 ? onClose : () => setStep(step - 1)}>{step === 0 ? 'Cancel' : 'Back'}</button>
      {step < 3 ? <button type="button" className="button primary" onClick={() => setStep(step + 1)}>Next</button>
        : <button type="button" className="button primary" disabled={busy || problems.length > 0} onClick={save}>{busy ? 'Saving…' : detail ? 'Save changes' : c.when === 'now' ? 'Publish' : c.when === 'schedule' ? 'Schedule' : 'Save draft'}</button>}</div></Dialog>
}

/** Recipients: what the school addressed to this person, with their own read and acknowledgement state. */
function FeedView({ perms }: { perms: Perms }) {
  const cache = useQueryClient(), [params, setParams] = useSearchParams(), [page, setPage] = useState(1), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const feed = useQuery<Feed>({ queryKey: ['suite', 'communications', 'feed', page], queryFn: () => data('/communications/feed', { page }) })
  const openId = params.get('open'), open = feed.data?.items.find(i => i.id === openId) ?? null
  useEffect(() => { if (open && !open.readAt) client.post('/suite/communications/' + open.id + '/read').then(() => cache.invalidateQueries({ queryKey: ['suite', 'communications', 'feed'] })).catch(() => {}) }, [open?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const show = (item: FeedItem | null) => setParams(p => { if (item) p.set('open', item.id); else p.delete('open'); return p })
  async function acknowledge(item: FeedItem) { setBusy(true); setError(''); try { await client.post('/suite/circulars/' + item.id + '/acknowledge'); await cache.invalidateQueries({ queryKey: ['suite', 'communications', 'feed'] }) } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) } }
  return <><PageHeader eyebrow="COMMUNICATION" title="Notices & circulars" description="What your school has sent you. Open one to read it; acknowledge where the school asks you to." />
    {error && <ErrorBox message={error} />}
    <section className="panel com-panel" aria-label="Communications addressed to you"><div className="directory-toolbar"><div><h2>Your communications</h2><p>{feed.data ? feed.data.total + ' in total' + (feed.data.acknowledgementsDue ? ' · ' + feed.data.acknowledgementsDue + ' to acknowledge' : '') : ''}</p></div></div>
      {feed.isPending ? <Loading /> : feed.isError ? <ErrorBox message={errorMessage(feed.error)} /> : !feed.data.items.length ? <Empty title="Nothing yet" description="Communications addressed to you will appear here." /> :
        <ul className="com-feed">{feedOrder(feed.data.items).map(i => <li key={i.id} className={i.readAt ? '' : 'unread'}><button type="button" className="com-row" onClick={() => show(i)} aria-label={(i.readAt ? '' : 'Unread: ') + i.title}>
          <span className="stat-icon teal"><Megaphone size={16} /></span><span className="com-row-body"><strong>{i.title}</strong><small>{i.className ? i.className + ' · ' : ''}{shortWhen(i.publishedAt)}{i.expired ? ' · expired' : ''}</small></span>
          <span className="com-tags">{i.priority !== 'Normal' && <span className={'status-tag ' + priorityTone(i.priority)}>{i.priority}</span>}{i.requiresAcknowledgement && <span className={'status-tag ' + (i.acknowledgedAt ? 'active' : 'important')}>{i.acknowledgedAt ? 'Acknowledged' : 'To acknowledge'}</span>}</span></button></li>)}</ul>}
      {feed.data && <Pagination page={page} total={feed.data.total} size={feed.data.pageSize} onChange={setPage} />}</section>
    {open && <Dialog title={open.title} onClose={() => show(null)}><p className="com-meta"><Tag item={open} /> {open.className && <span className="status-tag">{open.className}</span>} <Clock size={13} aria-hidden="true" /> {shortWhen(open.publishedAt)}</p>
      <div className="com-message">{open.message}</div><Attachments recordId={open.id} canUpload={false} />
      {open.requiresAcknowledgement && <div className="modal-footer">{open.acknowledgedAt ? <span className="success-box" role="status"><Check size={16} />You acknowledged this on {shortWhen(open.acknowledgedAt)}.</span>
        : perms.acknowledge ? <button className="button primary" disabled={busy} onClick={() => acknowledge(open)}>{busy ? 'Saving…' : 'Acknowledge'}</button> : <span className="muted">Your account cannot acknowledge communications.</span>}</div>}</Dialog>}
  </>
}
