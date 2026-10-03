import { Guard } from '@/access/Guard'
import { ResultsScreen } from '@/features/results/ResultsScreen'

export default function Route() {
  return <Guard route="/results"><ResultsScreen /></Guard>
}
