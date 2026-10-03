import { Guard } from '@/access/Guard'
import { RegisterScreen } from '@/features/attendance/RegisterScreen'

export default function Route() {
  return <Guard route="/register"><RegisterScreen /></Guard>
}
