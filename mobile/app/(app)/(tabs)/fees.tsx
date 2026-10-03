import { Guard } from '@/access/Guard'
import { FeesScreen } from '@/features/fees/FeesScreen'

export default function Route() {
  return <Guard route="/fees"><FeesScreen /></Guard>
}
