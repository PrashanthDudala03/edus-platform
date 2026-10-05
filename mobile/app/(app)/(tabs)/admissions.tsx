import { Guard } from '@/access/Guard'
import { AdmissionsScreen } from '@/features/admissions/AdmissionsScreen'

export default function Route() {
  return <Guard route="/admissions"><AdmissionsScreen /></Guard>
}
