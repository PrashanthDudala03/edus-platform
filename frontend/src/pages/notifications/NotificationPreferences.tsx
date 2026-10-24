import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import client, { errorMessage } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { ErrorBox, Loading } from '../../components/UI'
import { browserAlertKey, browserAlertsEnabled } from './notificationBrowser'
import { categoryLabel } from './inbox'
type Preferences = { categories: string[], disabled: { category: string, channel: string }[] }
export default function NotificationPreferences() {
  const user = useAuthStore(s => s.user)!, cache = useQueryClient()
  const prefs = useQuery<Preferences>({ queryKey: ['notifications', 'preferences', user.schoolId, user.id], queryFn: async () => (await client.get('/notifications/preferences')).data.data })
  const [browser, setBrowser] = useState(() => browserAlertsEnabled(user.schoolId, user.id)), [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('')
  async function toggle(category: string, enabled: boolean) { setBusy(category); setError(''); try { await client.put('/notifications/preferences', { category, channel: 'in-app', enabled }); await cache.invalidateQueries({ queryKey: ['notifications', 'preferences'] }) } catch (e) { setError(errorMessage(e)) } finally { setBusy('') } }
  async function toggleBrowser(enabled: boolean) {
    setError(''); setMessage('')
    try {
      if (enabled && (typeof Notification === 'undefined' || !window.isSecureContext)) { setMessage('Browser alerts are not supported here. The in-app inbox still works.'); return }
      if (enabled && await Notification.requestPermission() !== 'granted') { setMessage('Browser alerts were not allowed. You can change this site’s permissions in your browser.'); return }
      localStorage.setItem(browserAlertKey(user.schoolId, user.id), enabled ? '1' : '0'); setBrowser(enabled)
    } catch { setMessage('This browser could not save alert preferences. The in-app inbox still works.') }
  }
  return <details className="panel notification-preferences"><summary>Notification preferences</summary><div><p>Choose routine updates for your own account. Urgent notices and notices requiring acknowledgement can still appear in your inbox.</p><p>Built-in notifications use no external messaging provider. Browser alerts work only while EduOS is running.</p>{error && <ErrorBox message={error}/>} {message && <p role="status">{message}</p>}
    <label className="notification-preference"><input type="checkbox" checked={browser} onChange={e => void toggleBrowser(e.target.checked)}/>Allow browser alerts on this device</label>
    {prefs.isPending ? <Loading/> : prefs.isError ? <ErrorBox message={errorMessage(prefs.error)}/> : prefs.data.categories.map(category => <label className="notification-preference" key={category}><input type="checkbox" disabled={!!busy} checked={!prefs.data.disabled.some(p => p.category === category && p.channel === 'in-app')} onChange={e => void toggle(category, e.target.checked)}/>{categoryLabel(category)}</label>)}
  </div></details>
}
