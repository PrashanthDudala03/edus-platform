import { useState } from 'react'
import { Dialog, ErrorBox } from './UI'
import { AccessChangePreview } from './AccessChangePreview'
type Account = { id: string, firstName: string, lastName: string, email: string, phoneNumber: string, roleId: string, isActive: boolean }
type Role = { id: string, name: string, canAssign: boolean, dataScope: string, effectivePermissions: string[] }
export default function AccountAccessEditor({ account, roles, busy, close, save, error }: { account: Account, roles: Role[], error?: string, busy: boolean, close: () => void, save: (body: unknown) => void }) {
  const [roleId, setRole] = useState(account.roleId), [active, setActive] = useState(account.isActive)
  const before = roles.find(r => r.id === account.roleId), after = roles.find(r => r.id === roleId)
  return <Dialog title={'Manage ' + account.firstName + ' ' + account.lastName} onClose={() => !busy && close()}><form className="iam-editor-form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); save({ roleId, isActive: active, firstName: f.get('firstName'), lastName: f.get('lastName'), email: f.get('email'), phoneNumber: f.get('phoneNumber') }) }}>
    {error && <ErrorBox message={error}/>}
    <fieldset><legend>Account details</legend><div className="form-grid"><label>First name<input name="firstName" required maxLength={100} defaultValue={account.firstName}/></label><label>Last name<input name="lastName" required maxLength={100} defaultValue={account.lastName}/></label><label>Email<input name="email" type="email" required defaultValue={account.email}/></label><label>Phone<input name="phoneNumber" maxLength={20} defaultValue={account.phoneNumber}/></label></div></fieldset>
    <fieldset><legend>School access</legend><label>Assigned role<select aria-label="Assigned role" value={roleId} onChange={e => setRole(e.target.value)} required>{roles.filter(r => r.canAssign || r.id === account.roleId).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label><label><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}/> Account active</label></fieldset>
    <AccessChangePreview before={account.isActive ? before?.effectivePermissions || [] : []} after={active ? after?.effectivePermissions || [] : []} scopeBefore={before?.dataScope} scopeAfter={after?.dataScope}/>
    {!active && <p className="info-box">This account will be disabled and cannot sign in.</p>}<p>Saving ends current sessions. Existing profile links remain intact.</p>
    <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={close}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save access'}</button></div>
  </form></Dialog>
}
