import { Guard } from '@/access/Guard'
import { OverviewScreen } from '@/features/principal/OverviewScreen'

export default function Route() {
  return <Guard route="/overview"><OverviewScreen /></Guard>
}
