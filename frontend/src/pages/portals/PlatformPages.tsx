import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, CheckCircle2, CircleOff, Users, GraduationCap, Plus, Search, Eye, Pencil, UserPlus, Power } from 'lucide-react'
import client, { errorMessage } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { Dialog, Empty, ErrorBox, Loading, PageHeader } from '../../components/UI'
import { Panel, StatTile } from './widgets'
type School = { id: string, name: string, principalName?: string, isActive: boolean, subscriptionTier: string, createdAt?: string, users: number, administrators: number, students: number }
type RoleCount = { role: string, count: number, active: number }
type Overview = { schools: { total: number, active: number, inactive: number }, users: { total: number, active: number, byRole: RoleCount[] }, students: number, recentSchools: School[] }
type Details = { school: School, roles: RoleCount[], administrators: { id: string, username: string, email: string, firstName: string, lastName: string, isActive: boolean, lastLoginAt?: string }[] }
const tiers = ['trial', 'standard', 'premium']

// Platform administration. These pages call /platform/* only; the SuperAdmin never enters a school workspace.
export function PlatformDashboard() {
  const user = useAuthStore(s => s.user)
  const overview = useQuery<Overview>({ queryKey: ['platform', 'overview'], queryFn: async () => (await client.get('/platform/overview')).data.data })
  const o = overview.data
  return <><PageHeader eyebrow="SUPER ADMIN PORTAL" title={'Platform overview, ' + (user?.firstName || 'administrator') + '.'} description="Schools on this EduOS deployment, their status and the accounts they hold."><Link className="button primary" to="/super-admin/schools"><Building2 size={17} />Manage schools</Link></PageHeader>
    {overview.isError ? <ErrorBox message={errorMessage(overview.error)} /> : overview.isPending ? <Loading /> : <>
      <div className="stats-grid">
        <StatTile label="Total schools" value={o!.schools.total} note="Registered on the platform" icon={Building2} tone="teal" to="/super-admin/schools" />
        <StatTile label="Active schools" value={o!.schools.active} note="Users can sign in" icon={CheckCircle2} tone="blue" />
        <StatTile label="Deactivated schools" value={o!.schools.inactive} note="Sign-in blocked" icon={CircleOff} tone="peach" />
        <StatTile label="Platform users" value={o!.users.total} note={o!.users.active + ' active accounts · ' + o!.students + ' student records'} icon={Users} tone="purple" />
      </div>
      <div className="dashboard-grid">
        <Panel title="Accounts by role" description="Across all schools">
          {o!.users.byRole.length ? <div className="table-scroll"><table><thead><tr><th>Role</th><th>Accounts</th><th>Active</th></tr></thead><tbody>{o!.users.byRole.map(r => <tr key={r.role}><td>{r.role}</td><td>{r.count}</td><td>{r.active}</td></tr>)}</tbody></table></div> : <Empty title="No school accounts yet" description="Create a school and its first administrator." />}
        </Panel>
        <Panel title="Recently onboarded" description="Newest schools first" link="/super-admin/schools">
          {o!.recentSchools.length ? <ul className="dash-list">{o!.recentSchools.map(s => <li key={s.id}><span className="stat-icon teal"><Building2 size={17} /></span><div><strong>{s.name}</strong><small>{s.administrators} administrator{s.administrators === 1 ? '' : 's'} · {s.students} students · {s.subscriptionTier}</small></div><span className={'status-tag ' + (s.isActive ? 'active' : '')}>{s.isActive ? 'Active' : 'Deactivated'}</span></li>)}</ul> : <Empty title="No schools yet" description="Onboard your first school." />}
        </Panel>
      </div></>}</>
}

export function SchoolsPage() {
  const cache = useQueryClient()
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState('all')
  const [dialog, setDialog] = useState<{ kind: 'create' | 'edit' | 'admin' | 'view', school?: School } | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  useEffect(() => { const t = setTimeout(() => setQuery(search.trim()), 250); return () => clearTimeout(t) }, [search])
  const schools = useQuery<School[]>({ queryKey: ['platform', 'schools', query, status], queryFn: async () => (await client.get('/platform/schools', { params: { search: query, status } })).data.data })
  const details = useQuery<Details>({ queryKey: ['platform', 'school', dialog?.school?.id], enabled: dialog?.kind === 'view', queryFn: async () => (await client.get('/platform/schools/' + dialog!.school!.id)).data.data })
  async function run(action: () => Promise<string>) { setBusy(true); setError(''); try { setMessage(await action()); setDialog(null); await cache.invalidateQueries({ queryKey: ['platform'] }) } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) } }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); const d = dialog!
    run(async () => {
      if (d.kind === 'create') { await client.post('/platform/schools', f); return 'School created. Add its first administrator next.' }
      if (d.kind === 'edit') { await client.put('/platform/schools/' + d.school!.id, f); return 'School saved.' }
      await client.post('/platform/schools/' + d.school!.id + '/administrators', f); return 'Administrator created for ' + d.school!.name + '. Share the credentials privately.'
    })
  }
  function toggle(s: School) {
    if (!window.confirm((s.isActive ? 'Deactivate ' : 'Activate ') + s.name + '?' + (s.isActive ? ' Every user of this school will be signed out and blocked from signing in.' : ''))) return
    run(async () => (await client.put('/platform/schools/' + s.id, { isActive: !s.isActive })).data.message)
  }
  return <><PageHeader eyebrow="SUPER ADMIN PORTAL" title="Schools" description="Onboard schools, manage their status and create their first administrators."><button className="button primary" onClick={() => { setError(''); setDialog({ kind: 'create' }) }}><Plus size={17} />Create school</button></PageHeader>
    {error && !dialog && <ErrorBox message={error} />} {message && <div className="success-box" role="status">{message}</div>}
    <section className="panel directory-panel"><div className="directory-toolbar"><div className="directory-title"><span className="stat-icon teal"><Building2 size={20} /></span><div><h2>All schools <span className="count-badge">{schools.data?.length ?? '—'}</span></h2><p>Search by school or principal name.</p></div></div>
      <div className="toolbar-actions"><div className="search-field"><Search size={17} /><input aria-label="Search schools" value={search} maxLength={100} onChange={e => setSearch(e.target.value)} placeholder="Search schools…" /></div><select aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Deactivated</option></select></div></div>
      {schools.isError ? <ErrorBox message={errorMessage(schools.error)} /> : schools.isPending ? <Loading /> : !schools.data.length ? <Empty title="No schools found" description={query || status !== 'all' ? 'Try another search or status.' : 'Create the first school on this platform.'} /> :
        <div className="table-scroll"><table><thead><tr><th>School</th><th>Plan</th><th>Status</th><th>Accounts</th><th>Students</th><th className="align-right">Actions</th></tr></thead><tbody>{schools.data.map(s => <tr key={s.id}>
          <td><strong>{s.name}</strong><small className="cell-small">{s.principalName || 'Principal not set'}</small></td><td className="capitalize">{s.subscriptionTier}</td>
          <td><span className={'status-tag ' + (s.isActive ? 'active' : '')}>{s.isActive ? 'Active' : 'Deactivated'}</span></td><td>{s.users} ({s.administrators} admin)</td><td>{s.students}</td>
          <td><div className="row-actions"><button className="icon-button" aria-label={'View ' + s.name} onClick={() => setDialog({ kind: 'view', school: s })}><Eye size={16} /></button><button className="icon-button" aria-label={'Edit ' + s.name} onClick={() => { setError(''); setDialog({ kind: 'edit', school: s }) }}><Pencil size={16} /></button><button className="icon-button" aria-label={'Add administrator to ' + s.name} disabled={!s.isActive} onClick={() => { setError(''); setDialog({ kind: 'admin', school: s }) }}><UserPlus size={16} /></button><button className="button small secondary" disabled={busy} onClick={() => toggle(s)}><Power size={14} />{s.isActive ? 'Deactivate' : 'Activate'}</button></div></td></tr>)}</tbody></table></div>}
    </section>
    {dialog?.kind === 'view' && <Dialog title={dialog.school!.name} onClose={() => setDialog(null)}>{details.isPending ? <Loading /> : details.isError ? <ErrorBox message={errorMessage(details.error)} /> : <>
      <dl className="record-details"><div><dt>School ID</dt><dd>{details.data.school.id}</dd></div><div><dt>Status</dt><dd>{details.data.school.isActive ? 'Active' : 'Deactivated'}</dd></div><div><dt>Plan</dt><dd>{details.data.school.subscriptionTier}</dd></div><div><dt>Principal</dt><dd>{details.data.school.principalName || '—'}</dd></div><div><dt>Student records</dt><dd>{details.data.school.students}</dd></div><div><dt>Accounts by role</dt><dd>{details.data.roles.map(r => r.role + ': ' + r.count).join(' · ')}</dd></div></dl>
      <div className="attachment-box"><h3>Administrators</h3>{details.data.administrators.length ? details.data.administrators.map(a => <p key={a.id}><GraduationCap size={14} /> {a.firstName} {a.lastName} · {a.username} · {a.isActive ? 'enabled' : 'disabled'}</p>) : <p className="muted">No administrator yet.</p>}</div></>}</Dialog>}
    {dialog && dialog.kind !== 'view' && <Dialog title={dialog.kind === 'create' ? 'Create school' : dialog.kind === 'edit' ? 'Edit ' + dialog.school!.name : 'Add administrator · ' + dialog.school!.name} onClose={() => !busy && setDialog(null)}><form onSubmit={submit}>{error && <ErrorBox message={error} />}
      {dialog.kind === 'admin' ? <div className="form-grid"><label>First name<input name="firstName" required maxLength={100} /></label><label>Last name<input name="lastName" required maxLength={100} /></label><label>Username<input name="username" required minLength={3} maxLength={100} autoComplete="off" /></label><label>Email address<input name="email" type="email" required maxLength={255} /></label><label className="full-width">Password<input name="password" type="password" required minLength={16} maxLength={72} autoComplete="new-password" /><small>16–72 characters. Share it privately with the administrator.</small></label></div>
        : <div className="form-stack"><label>School name<input name="name" required maxLength={255} defaultValue={dialog.school?.name} /></label><label>Principal name<span className="optional"> (optional)</span><input name="principalName" maxLength={255} defaultValue={dialog.school?.principalName || ''} /></label><label>Plan<select name="subscriptionTier" defaultValue={dialog.school?.subscriptionTier || 'trial'}>{tiers.map(t => <option key={t} value={t}>{t}</option>)}</select></label></div>}
      <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={() => setDialog(null)}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : dialog.kind === 'create' ? 'Create school' : dialog.kind === 'edit' ? 'Save school' : 'Create administrator'}</button></div></form></Dialog>}</>
}
