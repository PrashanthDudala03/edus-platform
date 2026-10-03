import { memo, useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import { normalizeError } from '@/api/errors'
import { Chips, Header } from '@/components/blocks'
import { ListScreen } from '@/components/ListScreen'
import { AppText, Badge, Button, Notice } from '@/components/ui'
import { color, elevation, radius, space } from '@/theme/tokens'
import { dayParts, isoDay, weekdayOf } from '@/utils/format'
import { usePermission, useRegister, useSaveRegister } from '../data'
import { STATUSES, classesOf, markRestPresent, recentDays, registerChanges, registerSummary, type AttendanceStatus, type RegisterRow } from '../logic'

// The daily register. A teacher sees and marks the students of their own classes; leadership sees the whole school.
// GET and POST /suite/student-attendance are the same calls the web register uses. Nothing is saved until Save is
// pressed, and only the entries that changed are sent.
const TONE: Record<AttendanceStatus, { background: string, text: string }> = {
  Present: { background: color.successSurface, text: color.successText }, Late: { background: color.warningSurface, text: color.warningText },
  Absent: { background: color.dangerSurface, text: color.danger }, Excused: { background: color.surfaceMuted, text: color.textMuted },
}
const Row = memo(function Row({ row, status, editable, onChoose }: { row: RegisterRow, status: AttendanceStatus | '', editable: boolean, onChoose: (id: string, status: AttendanceStatus) => void }) {
  return <View style={styles.row}><View style={styles.flex}><AppText variant="bodyStrong" numberOfLines={1}>{row.name}</AppText><AppText variant="caption" tone="muted" numberOfLines={1}>{[row.code, row.className].filter(Boolean).join(' · ')}</AppText></View>
    {editable ? <View style={styles.choices} accessibilityRole="radiogroup">{STATUSES.map(option => { const active = status === option
      return <Pressable key={option} accessibilityRole="radio" accessibilityState={{ selected: active }} accessibilityLabel={`${row.name}: ${option}`} hitSlop={4} onPress={() => onChoose(row.id, option)}
        style={[styles.choice, active && { backgroundColor: TONE[option].background, borderColor: TONE[option].text }]}><AppText variant="label" style={{ color: active ? TONE[option].text : color.textFaint }}>{option[0]}</AppText></Pressable> })}</View>
      : <Badge label={status || 'Not marked'} tone={status === 'Present' ? 'success' : status === 'Absent' ? 'danger' : status === 'Late' ? 'warning' : 'neutral'} />}</View>
})

export function RegisterScreen() {
  const today = isoDay(new Date()), params = useLocalSearchParams<{ class?: string }>(), insets = useSafeAreaInsets()
  const [day, setDay] = useState(today), [group, setGroup] = useState(typeof params.class === 'string' ? params.class : ''), [draft, setDraft] = useState<Record<string, AttendanceStatus>>({}), [notice, setNotice] = useState<{ tone: 'info' | 'danger', text: string } | null>(null)
  const register = useRegister(day), save = useSaveRegister(day), mayMark = usePermission('attendance.mark')
  const rows = register.data, classes = useMemo(() => classesOf(rows ?? []), [rows]), active = classes.includes(group) ? group : ''
  const shown = useMemo(() => rows?.filter(row => !active || row.className === active), [rows, active])
  const summary = registerSummary(shown ?? [], draft), changes = registerChanges(rows ?? [], draft)
  const choose = useCallback((id: string, status: AttendanceStatus) => { setNotice(null); setDraft(current => ({ ...current, [id]: status })) }, [])
  const pick = (next: string) => { setDay(next); setDraft({}); setNotice(null) }
  const submit = () => save.mutate(changes, { onSuccess: () => { setDraft({}); setNotice({ tone: 'info', text: `Attendance saved for ${changes.length} ${changes.length === 1 ? 'student' : 'students'}.` }) }, onError: error => setNotice({ tone: 'danger', text: normalizeError(error).message }) })
  return <ListScreen source={register} items={shown} keyOf={row => row.id}
    top={<><Header overline={day === today ? 'Today' : weekdayOf(new Date(day + 'T00:00:00'))} title="Attendance" route="/register" />
      <Chips value={day} onChange={pick} options={recentDays(today, 7).reverse().map(value => ({ key: value, label: value === today ? 'Today' : `${weekdayOf(new Date(value + 'T00:00:00')).slice(0, 3)} ${dayParts(value)?.day}` }))} />
      {classes.length > 1 && <Chips value={active} onChange={setGroup} options={[{ key: '', label: 'All classes' }, ...classes.map(value => ({ key: value, label: value }))]} />}
      {!!shown?.length && <AppText variant="caption" tone="muted">{summary.Present} present · {summary.Late} late · {summary.Absent} absent · {summary.Excused} excused · {summary.unmarked} not marked</AppText>}
      {!!notice && <Notice tone={notice.tone} message={notice.text} />}
      {mayMark && !!shown?.length && <AppText variant="caption" tone="faint">P present · L late · A absent · E excused</AppText>}</>}
    empty={{ icon: 'people-outline', title: 'No students to mark', message: mayMark ? 'Students appear here once classes are assigned to you and students are allocated to them.' : 'No students are available for this account.' }}
    row={row => <Row row={row} status={draft[row.id] ?? row.status} editable={mayMark} onChoose={choose} />}
    bottom={mayMark && !!shown?.length ? <View style={[styles.bar, { paddingBottom: insets.bottom + space.md }]}>
      {summary.unmarked > 0 && <Button label="Mark the rest present" variant="secondary" onPress={() => setDraft(current => markRestPresent(shown ?? [], current))} style={styles.flex} />}
      <Button label={changes.length ? `Save ${changes.length}` : 'Saved'} icon="checkmark" disabled={changes.length === 0} loading={save.isPending} onPress={submit} style={styles.flex} /></View> : undefined} />
}
const styles = StyleSheet.create({
  flex: { flex: 1 }, row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  choices: { flexDirection: 'row', gap: 6 }, choice: { width: 40, height: 40, borderRadius: radius.md, borderWidth: 1, borderColor: color.border, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },
  bar: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.md, backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.border, ...elevation.raised },
})
