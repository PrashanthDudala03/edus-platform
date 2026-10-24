export const browserAlertKey = (school: string, user: string) => `eduos.browser-alerts.${school}.${user}`
export function browserAlertsEnabled(school: string, user: string) {
  try { return typeof Notification !== 'undefined' && Notification.permission === 'granted' && localStorage.getItem(browserAlertKey(school, user)) === '1' } catch { return false }
}
