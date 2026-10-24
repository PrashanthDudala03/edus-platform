import { permissionLabel } from './PermissionSummary'

export function AccessChangePreview({ before, after, scopeBefore, scopeAfter }: { before: string[], after: string[], scopeBefore?: string, scopeAfter?: string }) {
  const old = new Set(before), next = new Set(after), added = [...next].filter(p => !old.has(p)), removed = [...old].filter(p => !next.has(p))
  return <section className="iam-change-preview" aria-label="Access change preview"><h3>Access change preview</h3>
    {scopeBefore !== scopeAfter && <p>Record scope: <strong>{scopeBefore || 'None'}</strong> → <strong>{scopeAfter || 'None'}</strong>. Verified profile links still apply.</p>}
    {!added.length && !removed.length ? <p>No permission changes.</p> : <div className="iam-change-columns">{[['Permissions added', added], ['Permissions removed', removed]].map(([title, items]) => <div key={title as string}><h4>{title as string} ({(items as string[]).length})</h4>{(items as string[]).length ? <ul>{(items as string[]).map(key => <li key={key}>{permissionLabel(key)} <code>{key}</code></li>)}</ul> : <p>None</p>}</div>)}</div>}
    <p>{next.size} effective permissions after saving. The server validates the change again.</p>
  </section>
}
