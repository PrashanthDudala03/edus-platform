import { useState } from 'react'
import { Chips, Header, ListItem } from '@/components/blocks'
import { ListScreen } from '@/components/ListScreen'
import { Badge } from '@/components/ui'
import { dayParts, isoDay } from '@/utils/format'
import { useExams, useNames } from '../data'

// Exams the account may see: the published ones for families, drafts as well for staff. Read only on mobile;
// scheduling exams and entering marks in bulk stay on the web.
export function ExamsScreen() {
  const exams = useExams(), name = useNames(), [tab, setTab] = useState('upcoming'), today = isoDay(new Date())
  const sorted = exams.data && [...exams.data].sort((a, b) => a.date.localeCompare(b.date)), upcoming = sorted?.filter(exam => exam.date >= today), past = sorted?.filter(exam => exam.date < today).reverse()
  return <ListScreen source={exams} items={tab === 'upcoming' ? upcoming : past} keyOf={exam => exam.id}
    top={<><Header overline="Academics" title="Exams" route="/exams" /><Chips value={tab} onChange={setTab} options={[{ key: 'upcoming', label: 'Upcoming', count: upcoming?.length }, { key: 'past', label: 'Held', count: past?.length }]} /></>}
    empty={tab === 'upcoming' ? { icon: 'school-outline', title: 'No exams scheduled', message: 'Upcoming exams for your classes will appear here.' } : { icon: 'school-outline', title: 'No earlier exams', message: 'Exams that have been held are listed here.' }}
    row={(exam, index, all) => <ListItem icon="school-outline" title={exam.name} subtitle={[name('subjects', exam.subjectId), name('classes', exam.classId)].filter(Boolean).join(' · ')}
      meta={`${dayParts(exam.date)?.label ?? exam.date} · ${exam.maxMarks} marks, pass ${exam.passMarks}`} last={index === all.length - 1} trailing={exam.status === 'Published' ? undefined : <Badge label={exam.status || 'Draft'} tone="warning" />} />} />
}
