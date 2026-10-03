import { canOpen, type Destination } from '../access/experience.ts'
import type { User } from '../session/types.ts'

// Where a notification leads. A notification names a type; the app (not the sender) decides which screen that opens,
// after checking who is signed in, so a tap can never open a screen the person may not see. The same function will
// serve push taps and deep links when push arrives; device registration is still only a seam.
export type NotificationType =
  | 'attendance.absent' | 'homework.assigned' | 'homework.due' | 'result.published' | 'fee.due' | 'fee.overdue' | 'circular.published'
  | 'message.received' | 'leave.requested' | 'leave.approved' | 'leave.rejected' | 'timetable.changed' | 'school-home.published'

/** What a notification will carry. Ids are opaque; the server authorises them again when the screen loads. */
export interface NotificationPayload { type: string, entityId?: string, studentId?: string }

// Types point at the nearest screen that exists today. As modules are built, only this table changes.
// Each type lists the screens it may open, most specific first; the first one the account can open is used.
const DESTINATIONS: Record<NotificationType, Destination[]> = {
  'attendance.absent': ['/children', '/register'],
  'homework.assigned': ['/homework'],
  'homework.due': ['/homework'],
  'result.published': ['/results'],
  'fee.due': ['/fees'],
  'fee.overdue': ['/fees'],
  'circular.published': ['/notices'],
  'message.received': ['/notices'],
  'leave.requested': ['/leave'],
  'leave.approved': ['/leave'],
  'leave.rejected': ['/leave'],
  'timetable.changed': ['/timetable'],
  'school-home.published': ['/welcome'],
}
export const isNotificationType = (type: string): type is NotificationType => Object.prototype.hasOwnProperty.call(DESTINATIONS, type)

export interface NotificationTarget {
  /** Where to go now. */
  route: Destination | '/login'
  /** Where to continue after signing in, when the person was signed out. */
  afterSignIn?: Destination
  reason: 'opened' | 'signed-out' | 'not-allowed' | 'unknown-type'
}
/**
 * Decides where a tapped notification (or any deep link) leads. Signed out: the sign-in screen, remembering the
 * destination. Signed in without access, or an unknown type: Home. It never returns a screen the account cannot open.
 */
export function resolveNotificationRoute(payload: NotificationPayload, user: User | null | undefined): NotificationTarget {
  const candidates = isNotificationType(payload.type) ? DESTINATIONS[payload.type] : null
  if (!user) return { route: '/login', reason: 'signed-out', ...(candidates ? { afterSignIn: candidates[0] } : {}) }
  if (!candidates) return { route: '/home', reason: 'unknown-type' }
  const destination = candidates.find(route => canOpen(user, route))
  return destination ? { route: destination, reason: 'opened' } : { route: '/home', reason: 'not-allowed' }
}

/**
 * The seam for device registration. Phase 1 registers nothing; the next phase replaces these two functions with the
 * real calls. Sign-out already runs `unregister` while the session is still valid, so the server can forget the token.
 */
export interface DeviceRegistration { register(user: User): Promise<void>, unregister(): Promise<void> }
export const deviceRegistration: DeviceRegistration = { async register() {}, async unregister() {} }
