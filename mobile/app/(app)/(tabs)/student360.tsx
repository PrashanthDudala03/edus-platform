import { Guard } from '@/access/Guard'
import { Student360Screen } from '@/features/student360/Student360Screen'

export default function Route() {
  return <Guard route="/student360"><Student360Screen /></Guard>
}
