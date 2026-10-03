import { Guard } from '@/access/Guard'
import { NoticesScreen } from '@/features/notices/NoticesScreen'

export default function Route() {
  return <Guard route="/notices"><NoticesScreen /></Guard>
}
