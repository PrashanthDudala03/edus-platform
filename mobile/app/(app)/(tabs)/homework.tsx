import { Guard } from '@/access/Guard'
import { HomeworkScreen } from '@/features/homework/HomeworkScreen'

export default function Route() {
  return <Guard route="/homework"><HomeworkScreen /></Guard>
}
