import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck } from 'lucide-react'
import client, { errorMessage } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { canVisit } from '../../access'
import { Empty, ErrorBox, Loading, PageHeader, Pagination } from '../../components/UI'
import { ago, categoryLabel, destinationPath, unreadBadge, type Inbox, type InboxItem } from './inbox'

// The web inbox: this person's own notifications from the EduOS engine. The server binds every call to the signed-in
// account; the page only lists, marks read and opens the permitted page a notification points to.
export function useUnread() {
  const user = useAuthStore(s => s.user), platform = user?.dataScope === 'platform'
  return useQuery<number>({ queryKey: ['notifications', 'unread'], enabled: !!user && !platform, retry: false, refetchInterval: 60_000, queryFn: async () => Number((await client.get('/notifications/unread-count')).data.data.unread) || 0 })
}
/** The bell in the workspace header: opens the inbox and shows how many are unread. Quiet when the engine is not available. */
export function NotificationBell() {
  const unread = useUnread(), count = unread.data ?? 0, badge = unreadBadge(count)
  if (unread.isError) return null
  return <Link to="/notifications" className="bell" aria-label={count ? 'Notifications, ' + count + ' unread' : 'Notifications'} title="Notifications"><Bell size={19} />{badge && <span className="bell-badge" aria-hidden="true">{badge}</span>}</Link>
}

export default function NotificationInboxPage() {
  const cache = useQueryClient(), navigate = useNavigate(), user = useAuthStore(s => s.user)
  const [page, setPage] = useState(1), [unreadOnly, setUnreadOnly] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const inbox = useQuery<Inbox>({ queryKey: ['notifications', 'inbox', page, unreadOnly], retry: false, queryFn: async () => (await client.get('/notifications', { params: { page, unread: unreadOnly } })).data.data })
  const refresh = () => cache.invalidateQueries({ queryKey: ['notifications'] })
  async function open(item: InboxItem) {
    setError('')
    try { if (!item.readAt) await client.post('/notifications/' + item.id + '/read') } catch (e) { setError(errorMessage(e)) }
    await refresh(); navigate(destinationPath(item.destination, path => canVisit(user, path)))
  }
  async function readAll() { setBusy(true); setError(''); try { await client.post('/notifications/read-all'); await refresh() } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) } }
  const header = <PageHeader eyebrow="INBOX" title="Notifications" description="What your school has told you: attendance, homework, results, fees, leave, timetable changes and communications.">
    {!!inbox.data?.unread && <button className="button secondary" disabled={busy} onClick={readAll}><CheckCheck size={16} />Mark all as read</button>}</PageHeader>
  if (inbox.isError) return <>{header}<section className="panel inbox-panel"><Empty title="Notifications are not switched on yet" description="Your school’s EduOS has not enabled the notification inbox. Nothing has been missed; notices are under Communications." /></section></>
  return <>{header}{error && <ErrorBox message={error} />}
    <section className="panel inbox-panel" aria-label="Your notifications"><div className="directory-toolbar"><div><h2>{unreadOnly ? 'Unread' : 'All notifications'}</h2><p>{inbox.data ? inbox.data.unread + ' unread of ' + inbox.data.totalCount : ''}</p></div>
      <div className="toolbar-actions"><label className="adm-check"><input type="checkbox" checked={unreadOnly} onChange={e => { setUnreadOnly(e.target.checked); setPage(1) }} />Unread only</label></div></div>
      {inbox.isPending ? <Loading /> : !inbox.data.items.length ? <Empty title="You are all caught up" description="New notifications from your school will appear here." /> :
        <ul className="inbox-list">{inbox.data.items.map(item => <li key={item.id} className={item.readAt ? '' : 'unread'}>
          <button type="button" className="inbox-item" aria-label={(item.readAt ? '' : 'Unread: ') + item.title} onClick={() => open(item)}>
            <span className="inbox-dot" aria-hidden="true" /><span className="inbox-body"><strong>{item.title}</strong>{item.body && <span className="inbox-text">{item.body}</span>}<small>{categoryLabel(item.category)} · {ago(item.createdAt)}</small></span></button></li>)}</ul>}
      {inbox.data && <Pagination page={inbox.data.page} total={inbox.data.totalCount} size={inbox.data.pageSize} onChange={setPage} />}</section>
  </>
}
