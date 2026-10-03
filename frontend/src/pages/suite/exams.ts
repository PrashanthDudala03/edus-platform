// Exams, marks and results as the web shows them. The server decides the lifecycle, who may enter marks, totals,
// grades and what families see; these helpers only shape the screens and pre-check an entry before it is sent.
export type ExamStatus = 'Draft' | 'Scheduled' | 'MarksEntry' | 'Submitted' | 'Approved' | 'Published' | 'Closed'
export const STATUSES: ExamStatus[] = ['Draft', 'Scheduled', 'MarksEntry', 'Submitted', 'Approved', 'Published', 'Closed']
export const STATUS_LABEL: Record<ExamStatus, string> = { Draft: 'Draft', Scheduled: 'Scheduled', MarksEntry: 'Marks entry', Submitted: 'Awaiting approval', Approved: 'Approved', Published: 'Published', Closed: 'Closed' }
export type SchemeType = 'Marks' | 'Grade' | 'Components'
export const SCHEME_TYPE_LABEL: Record<SchemeType, string> = { Marks: 'Marks', Grade: 'Grade only', Components: 'Components (Theory + Practical, Internal + External)' }
export type Component = { name: string, max: number, pass: number | null }
export type Scheme = { type: SchemeType, max: number, passMarks: number | null, gradeOnly: boolean, components: Component[], grades: { label: string, minPercent: number }[] }
export type Exam = { id: string, version?: number, name: string, term: string, yearId: string, yearName: string, classId: string, className: string, subjectId: string, subjectName: string, date: string, startsAt: string, endsAt: string, room: string, instructions: string, schemeId: string, schemeName: string, schemeType: SchemeType, maxMarks: string, passMarks: string, status: ExamStatus, resultsVisible: boolean,
  scheduledAt?: string, submittedAt?: string, submittedBy?: string, approvedAt?: string, publishedAt?: string, closedAt?: string, returnedAt?: string, returnReason?: string }
export type OverviewExam = Exam & { assigned: number, entered: number, missing: number, absent: number, exempt: number, average: number | null, passed: number, failed: number, distribution: Record<string, number>, scheme: Scheme }
export type Attention = { studentId: string, name: string, className: string, failed: number, subjects: string }
export type Totals = Record<string, number>
export type MarkStatus = 'Present' | 'Absent' | 'Exempt'
export const MARK_STATUSES: MarkStatus[] = ['Present', 'Absent', 'Exempt']
export type Mark = { id: string, version: number, status: MarkStatus, score: number | null, grade: string, pass: boolean, components: { name: string, max: number, score: number | null }[], remarks: string, enteredAt: string, changes: number }
export type SheetRow = { studentId: string, name: string, code: string, mark: Mark | null }
export type Sheet = { exam: Exam, scheme: Scheme, students: SheetRow[], entered: number, canEdit: boolean, canSubmit: boolean, canReview: boolean }
/** What the grid holds for one student before it is sent: text as typed, so a half-typed number is never rounded away. */
export type Entry = { status: MarkStatus, components: Record<string, string>, grade: string, remarks: string }
export type Result = { examId: string, exam: string, term: string, date: string, subject: string, status: MarkStatus, components: { name: string, max: number, score: number | null }[], score: number | null, maximum: number | null, percent: number | null, grade: string, pass: boolean, remarks: string, schemeType: SchemeType }
export type ReportCard = { school: Record<string, string>, student: { id: string, name: string, admissionNumber: string, class: string }, year: string, term: string, results: Result[], obtained: number, maximum: number, percent: number, grade: string, passed: number, failed: number,
  attendance: { present: number, absent: number, late: number, excused: number, markedDays: number, percent: number | null, from: string, to: string } | null, signatures: { classTeacher: string, principal: string }, generatedAt: string, note: string }

export const statusTone = (status: ExamStatus) => status === 'Published' || status === 'Approved' ? 'active' : status === 'Submitted' || status === 'MarksEntry' ? 'important' : ''
export const timeLabel = (exam: Pick<Exam, 'startsAt' | 'endsAt'>) => exam.startsAt ? exam.startsAt + (exam.endsAt ? '–' + exam.endsAt : '') : ''
export const dayLabel = (date: string) => date ? new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : ''
/** The timetable, one group per day in date order (the server already sorts; this only groups). */
export const byDay = <T extends { date: string }>(items: T[]) => { const groups: { date: string, items: T[] }[] = []; for (const item of items) { const last = groups[groups.length - 1]; if (last && last.date === item.date) last.items.push(item); else groups.push({ date: item.date, items: [item] }) } return groups }
export const upcoming = <T extends { date: string }>(items: T[], today: string) => items.filter(i => i.date >= today)

/** The stage buttons a person sees. Leadership moves forward or returns work; a teacher only submits once marks are in. */
export const nextActions = (status: ExamStatus, who: { leadership: boolean, teacher: boolean, entered: number }): { to: ExamStatus, label: string, reason?: boolean, secondary?: boolean }[] => {
  if (who.leadership) switch (status) {
    case 'Draft': return [{ to: 'Scheduled', label: 'Schedule' }]
    case 'Scheduled': return [{ to: 'MarksEntry', label: 'Open marks entry' }]
    case 'MarksEntry': return [{ to: 'Approved', label: 'Approve marks' }]
    case 'Submitted': return [{ to: 'Approved', label: 'Approve' }, { to: 'MarksEntry', label: 'Return for correction', reason: true, secondary: true }]
    case 'Approved': return [{ to: 'Published', label: 'Publish results' }, { to: 'MarksEntry', label: 'Return for correction', reason: true, secondary: true }]
    case 'Published': return [{ to: 'Closed', label: 'Close', secondary: true }, { to: 'Approved', label: 'Unpublish', reason: true, secondary: true }]
    case 'Closed': return [{ to: 'Published', label: 'Reopen', secondary: true }]
  }
  if (who.teacher && (status === 'Draft' || status === 'Scheduled' || status === 'MarksEntry') && who.entered > 0) return [{ to: 'Submitted', label: 'Submit for approval' }]
  return []
}
export const marksEditable = (status: ExamStatus, leadership: boolean) => leadership ? STATUSES.indexOf(status) <= 4 : STATUSES.indexOf(status) <= 2
export const completion = (exam: Pick<OverviewExam, 'assigned' | 'entered'>) => exam.assigned ? Math.min(100, Math.round(exam.entered / exam.assigned * 100)) : 0

/** The grid's starting values for one student, from what the server holds. */
export const toEntry = (row: SheetRow, scheme: Scheme): Entry => {
  const components: Record<string, string> = {}
  for (const c of scheme.components) { const found = row.mark?.components.find(x => x.name === c.name); components[c.name] = found?.score == null ? '' : String(found.score) }
  return { status: row.mark?.status ?? 'Present', components, grade: row.mark && scheme.gradeOnly ? row.mark.grade : '', remarks: row.mark?.remarks ?? '' }
}
const num = (text: string) => { const t = text.trim(); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : NaN }
/** The total a present student would get, for the running figure beside the row; null while incomplete. */
export const entryTotal = (entry: Entry, scheme: Scheme): number | null => {
  if (entry.status !== 'Present' || scheme.gradeOnly) return null
  let sum = 0; for (const c of scheme.components) { const v = num(entry.components[c.name] ?? ''); if (v === null || Number.isNaN(v)) return null; sum += v } return sum
}
export const gradeFor = (scheme: Scheme, percent: number) => scheme.grades.find(g => percent >= g.minPercent)?.label ?? scheme.grades[scheme.grades.length - 1]?.label ?? ''
/** What the server would refuse, said before the sheet is sent. Empty entries are skipped, not refused. */
export const entryProblem = (entry: Entry, scheme: Scheme): string | null => {
  if (entry.status !== 'Present') return null
  if (scheme.gradeOnly) return entry.grade.trim() === '' ? null : scheme.grades.some(g => g.label.toLowerCase() === entry.grade.trim().toLowerCase()) ? null : 'Use one of ' + scheme.grades.map(g => g.label).join(', ')
  for (const c of scheme.components) { const v = num(entry.components[c.name] ?? ''); if (v === null) continue; if (Number.isNaN(v) || v < 0 || v > c.max) return (scheme.type === 'Marks' ? 'Marks' : c.name) + ' must be between 0 and ' + c.max }
  return null
}
/** True when nothing has been typed for a present student (so there is nothing to save). */
export const isBlank = (entry: Entry, scheme: Scheme) => entry.status === 'Present' && (scheme.gradeOnly ? entry.grade.trim() === '' : scheme.components.every(c => (entry.components[c.name] ?? '').trim() === '')) && entry.remarks.trim() === ''
export const sameEntry = (a: Entry, b: Entry) => a.status === b.status && a.grade.trim() === b.grade.trim() && a.remarks.trim() === b.remarks.trim() && Object.keys({ ...a.components, ...b.components }).every(k => (a.components[k] ?? '').trim() === (b.components[k] ?? '').trim())
/** The rows that changed and are complete enough to send, in the shape the marksheet call takes. */
export const changedEntries = (rows: SheetRow[], drafts: Record<string, Entry>, scheme: Scheme) => rows.flatMap(row => {
  const draft = drafts[row.studentId]; if (!draft) return []
  const base = toEntry(row, scheme); if (sameEntry(draft, base) || (isBlank(draft, scheme) && !row.mark)) return []
  if (draft.status === 'Present' && !scheme.gradeOnly && entryTotal(draft, scheme) === null) return []     // incomplete: wait for every component
  const components: Record<string, number> = {}; for (const c of scheme.components) { const v = num(draft.components[c.name] ?? ''); if (v !== null && !Number.isNaN(v)) components[c.name] = v }
  return [{ studentId: row.studentId, status: draft.status, components, grade: draft.grade.trim(), remarks: draft.remarks.trim(), version: row.mark?.version }]
})
export const marksLabel = (mark: Pick<Mark, 'status' | 'score' | 'grade'> | null, scheme: Pick<Scheme, 'max' | 'gradeOnly'>) => !mark ? '' : mark.status === 'Absent' ? 'Absent' : mark.status === 'Exempt' ? 'Exempt' : scheme.gradeOnly ? mark.grade : mark.score == null ? '' : mark.score + ' / ' + scheme.max + (mark.grade ? ' · ' + mark.grade : '')
export const componentsLabel = (components: { name: string, max: number, score: number | null }[]) => components.length > 1 ? components.map(c => c.name + ' ' + (c.score ?? '—') + '/' + c.max).join(' · ') : ''

export type Draft = { name: string, yearId: string, term: string, classId: string, subjectId: string, schemeId: string, maxMarks: string, passMarks: string, date: string, startsAt: string, endsAt: string, room: string, instructions: string, status: ExamStatus }
export const emptyDraft = (today: string): Draft => ({ name: '', yearId: '', term: '', classId: '', subjectId: '', schemeId: '', maxMarks: '100', passMarks: '40', date: today, startsAt: '', endsAt: '', room: '', instructions: '', status: 'Draft' })
export const toDraft = (e: Exam): Draft => ({ name: e.name, yearId: e.yearId, term: e.term, classId: e.classId, subjectId: e.subjectId, schemeId: e.schemeId, maxMarks: e.maxMarks, passMarks: e.passMarks, date: e.date, startsAt: e.startsAt, endsAt: e.endsAt, room: e.room, instructions: e.instructions, status: e.status })
/** Figures for the analytics tab: completion across exams, pending approvals, and the class and subject averages. */
export const analytics = (items: OverviewExam[]) => {
  const published = items.filter(i => i.resultsVisible && i.average !== null)
  const avg = (rows: OverviewExam[]) => rows.length ? Math.round(rows.reduce((n, i) => n + (i.average ?? 0), 0) / rows.length * 10) / 10 : null
  const group = (key: (i: OverviewExam) => string) => { const m = new Map<string, OverviewExam[]>(); for (const i of published) { const k = key(i); m.set(k, [...(m.get(k) ?? []), i]) } return [...m].map(([name, rows]) => ({ name, average: avg(rows)!, exams: rows.length, passed: rows.reduce((n, i) => n + i.passed, 0), failed: rows.reduce((n, i) => n + i.failed, 0) })).sort((a, b) => a.name.localeCompare(b.name)) }
  const distribution: Record<string, number> = {}; for (const i of published) for (const [g, n] of Object.entries(i.distribution)) distribution[g] = (distribution[g] ?? 0) + n
  return { expected: items.reduce((n, i) => n + i.assigned, 0), entered: items.reduce((n, i) => n + i.entered, 0), pendingApproval: items.filter(i => i.status === 'Submitted').length, entryIncomplete: items.filter(i => STATUSES.indexOf(i.status) <= 2 && i.missing > 0).length,
    classes: group(i => i.className), subjects: group(i => i.subjectName), passed: published.reduce((n, i) => n + i.passed, 0), failed: published.reduce((n, i) => n + i.failed, 0), distribution, published: published.length }
}
