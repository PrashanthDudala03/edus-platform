import { Guard } from '@/access/Guard'
import { NotificationsScreen } from '@/features/notifications/NotificationsScreen'

export default function Route() {
  return <Guard route="/notifications"><NotificationsScreen /></Guard>
}
