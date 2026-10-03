import { Guard } from '@/access/Guard'
import { LeaveScreen } from '@/features/leave/LeaveScreen'

export default function Route() {
  return <Guard route="/leave"><LeaveScreen /></Guard>
}
