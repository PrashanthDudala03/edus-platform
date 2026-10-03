import { Guard } from '@/access/Guard'
import { ExamsScreen } from '@/features/academics/ExamsScreen'

export default function Route() {
  return <Guard route="/exams"><ExamsScreen /></Guard>
}
