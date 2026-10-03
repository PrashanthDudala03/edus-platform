import { useState } from 'react'
import { experienceFor } from '@/access/experience'
import { normalizeError } from '@/api/errors'
import { Chips, Header, ListItem, Sheet } from '@/components/blocks'
import { ListScreen } from '@/components/ListScreen'
import { AppText, Badge, Button, Notice, TextField } from '@/components/ui'
import { useSession } from '@/services'
import { dayParts, isoDay } from '@/utils/format'
import { useChildren, useHomework, useNames, usePermission, useSubmissions, useSubmitHomework } from '../data'
import { splitHomework, type Homework } from '../logic'

// Homework for every role, from the homework records the account may read (the server limits them to the person's
// classes). Families also see whether work was handed in; a student can hand in a written response from here.
export function HomeworkScreen() {
  const user = useSession(state => state.user), experience = experienceFor(user), family = experience === 'parent' || experience === 'student'
  const homework = useHomework(), submissions = useSubmissions(family), children = useChildren(undefined, family), name = useNames()
  const maySubmit = usePermission('submissions.manage') && experience === 'student', submit = useSubmitHomework()
  const [tab, setTab] = useState('upcoming'), [open, setOpen] = useState<Homework | null>(null), [response, setResponse] = useState(''), [failure, setFailure] = useState('')
  const today = isoDay(new Date()), split = homework.data ? splitHomework(homework.data, today) : undefined
  const handedIn = (item: Homework) => (submissions.data ?? []).filter(s => s.homeworkId === item.id)
  const me = children.data?.[0], mine = open && me ? handedIn(open).find(s => s.studentId === me.studentId) : undefined
  const close = () => { setOpen(null); setResponse(''); setFailure('') }
  const send = () => { if (!open || !me) return; setFailure('')
    submit.mutate({ homeworkId: open.id, studentId: me.studentId, response: response.trim() }, { onSuccess: close, onError: error => setFailure(normalizeError(error).message) }) }
  return <><ListScreen source={homework} items={split?.[tab as 'upcoming' | 'past']} keyOf={item => item.id}
    top={<><Header overline="Learning" title="Homework" route="/homework" />
      <Chips value={tab} onChange={setTab} options={[{ key: 'upcoming', label: 'Due', count: split?.upcoming.length }, { key: 'past', label: 'Past', count: split?.past.length }]} /></>}
    empty={tab === 'upcoming' ? { icon: 'book-outline', title: 'No homework due', message: 'New assignments for your classes will appear here.' } : { icon: 'book-outline', title: 'No earlier homework', message: 'Assignments whose due date has passed are listed here.' }}
    row={(item, index, all) => { const done = handedIn(item)
      return <ListItem icon="book-outline" title={item.title} subtitle={[name('subjects', item.subjectId), name('classes', item.classId)].filter(Boolean).join(' · ')} meta={'Due ' + (dayParts(item.dueDate)?.label ?? item.dueDate)} last={index === all.length - 1} onPress={() => setOpen(item)}
        trailing={family && submissions.data ? <Badge label={done.length ? 'Handed in' : 'Not handed in'} tone={done.length ? 'success' : tab === 'past' ? 'danger' : 'warning'} /> : undefined} /> }} />
    <Sheet visible={!!open} title={open?.title ?? ''} onClose={close}
      footer={maySubmit && open && !mine && open.dueDate >= today ? <Button label="Hand in" icon="send" loading={submit.isPending} disabled={response.trim().length === 0} onPress={send} /> : undefined}>
      {open && <>
        <AppText variant="caption" tone="primary">{[name('subjects', open.subjectId), name('classes', open.classId), 'Due ' + (dayParts(open.dueDate)?.label ?? open.dueDate)].filter(Boolean).join(' · ')}</AppText>
        <AppText>{open.instructions}</AppText>
        {family && handedIn(open).map(s => <Notice key={s.id} message={`${children.data?.find(c => c.studentId === s.studentId)?.name ?? 'Handed in'}: ${s.response}${s.grade ? `\nGrade: ${s.grade}` : ''}${s.feedback ? `\nFeedback: ${s.feedback}` : ''}`} />)}
        {maySubmit && !mine && open.dueDate >= today && (me ? <TextField label="Your response" value={response} onChangeText={setResponse} multiline maxLength={4000} placeholder="Write your answer or notes for your teacher" style={{ minHeight: 110, textAlignVertical: 'top' }} />
          : <Notice tone="warning" message="Your account is not linked to a student record yet, so work cannot be handed in. Ask the school office." />)}
        {maySubmit && !mine && open.dueDate < today && <Notice message="The due date has passed, so this can no longer be handed in from the app." />}
        {!!failure && <Notice tone="danger" message={failure} />}
      </>}
    </Sheet></>
}
