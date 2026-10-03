import { Guard } from '@/access/Guard'
import { ClassesScreen } from '@/features/teacher/ClassesScreen'

export default function Route() {
  return <Guard route="/classes"><ClassesScreen /></Guard>
}
