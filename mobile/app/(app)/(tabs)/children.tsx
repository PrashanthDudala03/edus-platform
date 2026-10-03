import { Guard } from '@/access/Guard'
import { ChildrenScreen } from '@/features/parent/ChildrenScreen'

export default function Route() {
  return <Guard route="/children"><ChildrenScreen /></Guard>
}
