import { Guard } from '@/access/Guard'
import { TimetableScreen } from '@/features/student/TimetableScreen'

export default function Route() {
  return <Guard route="/timetable"><TimetableScreen /></Guard>
}
