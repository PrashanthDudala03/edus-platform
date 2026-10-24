import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { HubConnectionBuilder, HttpTransportType, LogLevel } from '@microsoft/signalr'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import client, { API_URL } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { browserAlertsEnabled } from './notificationBrowser'
import type { Inbox, InboxItem } from './inbox'

export default function LiveNotifications() {
  const user = useAuthStore(s => s.user), cache = useQueryClient(), navigate = useNavigate()
  const [toasts, setToasts] = useState<Pick<InboxItem, 'id' | 'title'>[]>([]), [state, setState] = useState('connecting')
  useEffect(() => {
    if (!user?.schoolId || user.dataScope === 'platform') return
    let active = true, retry: ReturnType<typeof setTimeout> | undefined, lastDesktop = 0
    const timers: ReturnType<typeof setTimeout>[] = [], seen = new Set<string>()
    setToasts([])
    const current = () => active && useAuthStore.getState().user?.id === user.id && useAuthStore.getState().user?.schoolId === user.schoolId
    const connection = new HubConnectionBuilder().withUrl(API_URL + '/notifications/live', {
      transport: HttpTransportType.LongPolling, accessTokenFactory: () => useAuthStore.getState().accessToken || '',
    }).withAutomaticReconnect([0, 2000, 10000]).configureLogging(LogLevel.None).build()
    const refresh = () => { if (current()) void cache.invalidateQueries({ queryKey: ['notifications'] }) }
    connection.on('NotificationsChanged', async ({ id }: { id?: string }) => {
      refresh()
      if (!current() || !id || seen.has(id)) return
      seen.add(id); if (seen.size > 100) seen.delete(seen.values().next().value!)
      try {
        const inbox = (await client.get('/notifications', { params: { unread: true } })).data.data as Inbox
        if (!current()) return
        const item = inbox.items.find(n => n.id === id); if (!item) return
        setToasts(rows => [...rows.filter(row => row.id !== id), { id, title: item.title }].slice(-3))
        timers.push(setTimeout(() => { if (current()) setToasts(rows => rows.filter(row => row.id !== id)) }, 10000))
        if (document.visibilityState === 'hidden' && browserAlertsEnabled(user.schoolId, user.id) && Date.now() - lastDesktop > 10000) {
          lastDesktop = Date.now()
          // Keep sensitive names, fee amounts and reasons off lock screens.
          const alert = new Notification('EduOS · New school notification', { body: 'Open EduOS to view the details.', tag: `${user.schoolId}:${user.id}:${id}` })
          alert.onclick = () => { window.focus(); navigate('/notifications'); alert.close() }
        }
      } catch { /* Inbox polling remains the fallback; a live hint never blocks school work. */ }
    })
    connection.onreconnecting(() => { if (current()) setState('reconnecting') })
    connection.onreconnected(() => { if (current()) { setState('connected'); refresh() } })
    const start = async () => {
      try {
        // Uses the existing refresh-token flow before reconnecting with an expired access token.
        await client.get('/notifications/unread-count')
        if (!current()) return
        await connection.start()
        if (current()) { setState('connected'); refresh() } else await connection.stop()
      } catch { if (current()) { setState('reconnecting'); retry = setTimeout(start, 15000) } }
    }
    connection.onclose(() => { if (current()) { setState('reconnecting'); retry = setTimeout(start, 15000) } })
    void start()
    return () => { active = false; clearTimeout(retry); timers.forEach(clearTimeout); void connection.stop() }
  }, [user?.id, user?.schoolId, cache, navigate])
  return <div className="notification-toasts" role="log" aria-label="Live notifications" data-live-state={state} aria-live="polite" aria-atomic="false">{toasts.map(item => <div className="notification-toast" key={item.id}><div><strong>{item.title}</strong><button className="text-link" onClick={() => { setToasts(rows => rows.filter(row => row.id !== item.id)); navigate('/notifications') }}>View notifications</button></div><button className="icon-button" aria-label={'Dismiss ' + item.title} onClick={() => setToasts(rows => rows.filter(row => row.id !== item.id))}><X size={16}/></button></div>)}</div>
}
