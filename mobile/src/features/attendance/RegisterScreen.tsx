import { memo, useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import { normalizeError } from '@/api/errors'
import { Chips, Header, Sheet } from '@/components/blocks'
import { ListScreen } from '@/components/ListScreen'
import { AppText, Badge, Button, Notice } from '@/components/ui'
import { color, elevation, radius, space } from '@/theme/tokens'
import { dayParts, isoDay, weekdayOf } from '@/utils/format'
import { usePermission, useRegister, useRegisters, useSaveRegister } from '../data'
import { REASONS, STATUSES, classesOf, isCorrection, markRestPresent, mayHaveReason, recentDays, registerDone, registerEntries, registerSummary, submittedClasses, type AttendanceStatus, type Reason, type RegisterRow } from '../logic'

// The daily register as a workflow: choose the day and class, mark everyone with one tap (or the rest present at
// once), add a reason where it helps, submit, and see the class marked as done. After submission a change is a
// correction: the server requires a reason and keeps the history. GET and POST /suite/student-attendance are the
// same calls the web register uses; only the entries that changed are sent.
const TONE: Record<AttendanceStatus, { background: string, text: string }> = {
  Present: { background: color.successSurface, text: color.successText }, Late: { background: color.warningSurface, text: color.warningText },
  Absent: { background: color.dangerSurface, text: color.danger }, Excused: { background: color.surfaceMuted, text: color.textMuted },
}
const Row = memo(function Row({ row, status, reason, editable, onChoose, onReason }: { row: RegisterRow, status: AttendanceStatus | '', reason: string, editable: boolean, onChoose: (id: string, status: AttendanceStatus) => void, onReason: (id: string) => void }) {
  return <View style={styles.row}><View style={styles.flex}><AppText variant="bodyStrong" numberOfLines={1}>{row.name}</AppText>
    <AppText variant="caption" tone="muted" numberOfLines={1}>{[row.code, row.className].filter(Boolean).join(' · ')}</AppText>
    {editable && mayHaveReason(status) && <Pressable accessibilityRole="button" accessibilityLabel={reason ? `Reason: ${reason}` : 'Add a reason'} hitSlop={6} onPress={() => onReason(row.id)}><AppText variant="caption" tone="primary">{reason || 'Add a reason'}</AppText></Pressable>}
    {!editable && !!reason && <AppText variant="caption" tone="muted" numberOfLines={1}>{reason}</AppText>}</View>
    {editable ? <View style={styles.choices} accessibilityRole="radiogroup">{STATUSES.map(option => { const active = status === option
      return <Pressable key={option} accessibilityRole="radio" accessibilityState={{ selected: active }} accessibilityLabel={`${row.name}: ${option}`} hitSlop={4} onPress={() => onChoose(row.id, option)}
        style={({ pressed }) => [styles.choice, active && { backgroundColor: TONE[option].background, borderColor: TONE[option].text }, pressed && styles.pressed]}><AppText variant="label" style={{ color: active ? TONE[option].text : color.textFaint }}>{option[0]}</AppText></Pressable> })}</View>
      : <Badge label={status || 'Not marked'} tone={status === 'Present' ? 'success' : status === 'Absent' ? 'danger' : status === 'Late' ? 'warning' : 'neutral'} />}</View>
})

export function RegisterScreen() {
  const today = isoDay(new Date()), params = useLocalSearchParams<{ class?: string }>(), insets = useSafeAreaInsets()
  const [day, setDay] = useState(today), [group, setGroup] = useState(typeof params.class === 'string' ? params.class : ''), [draft, setDraft] = useState<Record<string, AttendanceStatus>>({}), [reasons, setReasons] = useState<Record<string, Reason>>({})
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger', text: string } | null>(null), [asking, setAsking] = useState<string | 'correction' | null>(null), [pick, setPick] = useState<Reason>({ reason: '', remark: '' }), [confirming, setConfirming] = useState(false)
  const register = useRegister(day), registers = useRegisters(day), save = useSaveRegister(day), mayMark = usePermission('attendance.mark')
  const rows = register.data, classes = useMemo(() => classesOf(rows ?? []), [rows]), active = classes.includes(group) ? group : ''
  const shown = useMemo(() => rows?.filter(row => !active || row.className === active), [rows, active])
  const summary = registerSummary(shown ?? [], draft), entries = registerEntries(rows ?? [], draft, reasons), options = registers.data?.reasons.length ? registers.data.reasons : REASONS
  const submitted = submittedClasses(registers.data?.classes ?? []), correction = isCorrection(rows ?? [], draft, submitted), current = registers.data?.classes.find(r => r.className === active)
  const done = !!current && registerDone(current.state), complete = !!active && summary.unmarked === 0
  const choose = useCallback((id: string, status: AttendanceStatus) => { setNotice(null); setDraft(prev => ({ ...prev, [id]: status })) }, [])
  const askReason = useCallback((id: string) => { setPick({ reason: '', remark: '' }); setAsking(id) }, [])
  const changeDay = (next: string) => { setDay(next); setDraft({}); setReasons({}); setNotice(null) }
  const send = (submit: boolean, why?: Reason) => save.mutate({ entries, submit, ...(why ? why : {}) }, {
    onSuccess: result => { setDraft({}); setReasons({}); setAsking(null); setConfirming(false); setNotice({ tone: 'info', text: result.message || 'Attendance saved.' }) },
    onError: error => { setConfirming(false); setNotice({ tone: 'danger', text: normalizeError(error).message }) } })
  const primaryLabel = correction ? 'Record correction' : complete && !done ? 'Submit register' : entries.length ? `Save ${entries.length}` : 'Saved'
  const primary = () => correction ? (setPick({ reason: '', remark: '' }), setAsking('correction')) : complete && !done ? setConfirming(true) : send(false)
  return <>
    <ListScreen source={register} items={shown} keyOf={row => row.id}
      top={<><Header overline={day === today ? 'Today' : weekdayOf(new Date(day + 'T00:00:00'))} title="Attendance" route="/register" />
        <Chips value={day} onChange={changeDay} options={recentDays(today, 7).reverse().map(value => ({ key: value, label: value === today ? 'Today' : `${weekdayOf(new Date(value + 'T00:00:00')).slice(0, 3)} ${dayParts(value)?.day}` }))} />
        {classes.length > 1 && <Chips value={active} onChange={setGroup} options={[{ key: '', label: 'All classes' }, ...classes.map(value => ({ key: value, label: value }))]} />}
        {!!shown?.length && <View style={styles.summary}>{current && <Badge label={current.state} tone={done ? 'success' : current.state === 'Not started' ? 'neutral' : 'warning'} />}
          <AppText variant="caption" tone="muted" style={styles.flex}>{summary.Present} present · {summary.Late} late · {summary.Absent} absent · {summary.Excused} excused · {summary.unmarked} not marked{entries.length ? ` · ${entries.length} unsaved` : ''}</AppText></View>}
        {!!notice && <Notice tone={notice.tone} message={notice.text} />}
        {mayMark && !!shown?.length && <AppText variant="caption" tone="faint">P present · L late · A absent · E excused{done ? ' · this register is submitted; a change needs a reason' : ''}</AppText>}</>}
      empty={{ icon: 'people-outline', title: 'No students to mark', message: mayMark ? 'Students appear here once classes are assigned to you and students are allocated to them.' : 'No students are available for this account.' }}
      row={row => <Row row={row} status={draft[row.id] ?? row.status} reason={[reasons[row.id]?.reason ?? row.reason, reasons[row.id]?.remark ?? row.remark].filter(Boolean).join(': ')} editable={mayMark} onChoose={choose} onReason={askReason} />}
      bottom={mayMark && !!shown?.length ? <View style={[styles.bar, { paddingBottom: insets.bottom + space.md }]}>
        {summary.unmarked > 0 && <Button label="Mark the rest present" variant="secondary" onPress={() => setDraft(prev => markRestPresent(shown ?? [], prev))} style={styles.flex} />}
        <Button label={primaryLabel} icon={correction ? 'create-outline' : 'checkmark'} disabled={entries.length === 0 && !(complete && !done)} loading={save.isPending} onPress={primary} style={styles.flex} /></View> : undefined} />
    <Sheet visible={asking !== null} title={asking === 'correction' ? 'Reason for the correction' : 'Reason'} onClose={() => setAsking(null)}
      footer={<Button label={asking === 'correction' ? 'Record correction' : 'Done'} loading={save.isPending} disabled={asking === 'correction' ? !pick.reason && !pick.remark.trim() : pick.reason === 'Other' && !pick.remark.trim()}
        onPress={() => { if (asking === 'correction') send(false, { reason: pick.reason, remark: pick.remark.trim() }); else if (asking) { setReasons(prev => ({ ...prev, [asking]: { reason: pick.reason, remark: pick.remark.trim() } })); setAsking(null) } }} />}>
      {asking === 'correction' && <AppText tone="muted">This register was already submitted. The change is kept with the original, and the reason is recorded against your account.</AppText>}
      <Chips wrap value={pick.reason} onChange={value => setPick(prev => ({ ...prev, reason: prev.reason === value ? '' : value }))} options={options.map(value => ({ key: value, label: value }))} />
      <TextInput accessibilityLabel="Remark" value={pick.remark} onChangeText={value => setPick(prev => ({ ...prev, remark: value }))} maxLength={200} placeholder={pick.reason === 'Other' ? 'What happened' : 'Remark (optional)'} placeholderTextColor={color.textFaint} style={styles.input} />
    </Sheet>
    <Sheet visible={confirming} title="Submit the register" onClose={() => setConfirming(false)} footer={<><Button label="Not yet" variant="secondary" onPress={() => setConfirming(false)} /><Button label="Submit" icon="checkmark" loading={save.isPending} onPress={() => send(true)} /></>}>
      <AppText tone="muted">{entries.length ? `${entries.length} change${entries.length === 1 ? '' : 's'} will be saved and ` : ''}{active} will be marked as submitted for {day === today ? 'today' : day}. The school office sees it as complete; later changes are corrections with a reason.</AppText>
    </Sheet></>
}
const styles = StyleSheet.create({
  flex: { flex: 1 }, pressed: { opacity: 0.7 }, row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  choices: { flexDirection: 'row', gap: 6 }, choice: { width: 40, height: 40, borderRadius: radius.md, borderWidth: 1, borderColor: color.border, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.sm }, input: { minHeight: 44, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.md, color: color.text, backgroundColor: color.surface },
  bar: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.md, backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.border, ...elevation.raised },
})
