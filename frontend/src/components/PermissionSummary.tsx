import { useState } from 'react'

type Role = { id: string, name: string, description: string, enabled: boolean, dataScope: string, effectivePermissions: string[] }
type Permission = { key: string, module: string }
const words = (value: string) => value.replace(/[-_]/g, ' ')
const subjects: Record<string, string> = { users: 'user accounts', students: 'student records', teachers: 'teacher profiles', parents: 'guardian records', 'school-home': 'school appearance and welcome page', 'account-links': 'verified profile links', 'fee-structures': 'fee structures', 'access-history': 'access history' }
const actions: Record<string, string> = { view: 'View', manage: 'Manage', create: 'Create', update: 'Edit', archive: 'Archive', disable: 'Disable', assign: 'Assign', approve: 'Approve', review: 'Review', collect: 'Collect', mark: 'Mark', upload: 'Upload', acknowledge: 'Acknowledge', use: 'Use', purchase: 'Purchase' }
export function permissionLabel(key: string) {
  const parts = key.split('.'), action = parts.pop() || '', subject = parts.join('.')
  return `${actions[action] || words(action)} ${subjects[subject] || words(subject)}`.trim()
}
export default function PermissionSummary({ roles, permissions }: { roles: Role[], permissions: Permission[] }) {
  const [chosen, setChosen] = useState(''), [moduleFilter, setModule] = useState('')
  const role = roles.find(r => r.id === chosen) || roles[0]
  const effective = new Set(role?.enabled ? role.effectivePermissions : [])
  const held = permissions.filter(p => effective.has(p.key)), modules = [...new Set(held.map(p => p.module))].sort()
  return <section className="panel iam-permission-summary" aria-label="Role access summary">
    <div className="iam-summary-controls"><label>Role to inspect<select value={role?.id || ''} onChange={e => { setChosen(e.target.value); setModule('') }}>{roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label>Module<select value={moduleFilter} onChange={e => setModule(e.target.value)}><option value="">All modules</option>{modules.map(m => <option key={m}>{m}</option>)}</select></label></div>
    {role ? <><h3>{role.name}</h3><p>{role.description || 'Access granted to this role.'}</p><p><strong>{effective.size} effective permissions</strong> · {words(role.dataScope)} scope{!role.enabled && ' · Role disabled'}</p>
      <p className="iam-summary-note">Only permissions currently effective for this school are shown. Profile links still determine which records each person can access.</p>
      {!held.length ? <p>No effective permissions for this role.</p> : modules.filter(m => !moduleFilter || m === moduleFilter).map(module => <details className="iam-permission-group" key={module} open={!!moduleFilter}><summary>{module} <span className="count-badge">{held.filter(p => p.module === module).length}</span></summary><ul>{held.filter(p => p.module === module).map(p => <li key={p.key}><span>{permissionLabel(p.key)}</span><code>{p.key}</code></li>)}</ul></details>)}</> : <p>No roles available.</p>}
  </section>
}
