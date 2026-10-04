// The shapes EduOS returns for the core modules and the small rules the screens share. Pure functions only, so they
// are tested without a device. Nothing here computes a figure the server did not supply the parts for.
export type AttendanceStatus = 'Present' | 'Absent' | 'Late' | 'Excused'
export const STATUSES: AttendanceStatus[] = ['Present', 'Late', 'Absent', 'Excused']

export interface Child { studentId: string, name: string, className: string, classId: string, admissionNumber: string, present: number, absent: number, late: number, excused: number, markedDays: number }
export interface Homework { id: string, title: string, classId: string, subjectId: string, dueDate: string, instructions: string }
export type HomeworkGroup = 'due-today' | 'upcoming' | 'submitted' | 'reviewed' | 'late' | 'missing' | 'excused' | 'closed'
export const HOMEWORK_GROUPS: HomeworkGroup[] = ['due-today', 'upcoming', 'missing', 'late', 'submitted', 'reviewed', 'excused', 'closed']
export const GROUP_LABEL: Record<HomeworkGroup, string> = { 'due-today': 'Due today', upcoming: 'Upcoming', submitted: 'Completed', reviewed: 'Reviewed', late: 'Completed late', missing: 'Missing', excused: 'Excused', closed: 'Closed' }
/** How work comes back: information only, a tap to confirm, a written answer, files (web upload), or shown in class. */
export type SubmissionMode = 'None' | 'Done' | 'Text' | 'File' | 'Physical'
export const MODE_LABEL: Record<SubmissionMode, string> = { None: 'No online submission', Done: 'Mark as done', Text: 'Text response', File: 'Online file submission', Physical: 'Shown in class' }
export type Outcome = '' | 'Completed' | 'Late' | 'Missing' | 'Excused'
export const OUTCOMES: Exclude<Outcome, ''>[] = ['Completed', 'Late', 'Missing', 'Excused']
export interface HomeworkSubmission { id: string, version: number, status: 'Submitted' | 'Reviewed' | '', submittedAt: string, late: boolean, outcome: Outcome, response: string, grade: string, feedback: string, resubmissions: number, attachments: number }
export interface Assignment { id: string, title: string, className: string, subjectName: string, teacher: string, instructions: string, dueDate: string, dueTime: string, maxMarks: string, submissionMode: SubmissionMode, status: 'Draft' | 'Published' | 'Closed', attachments: number }
export const studentSubmits = (mode: SubmissionMode) => mode === 'Done' || mode === 'Text' || mode === 'File'
export const tracked = (mode: SubmissionMode) => mode !== 'None'
export interface BoardItem extends Assignment { group: HomeworkGroup, submission: HomeworkSubmission | null }
export interface OverviewItem extends Assignment { assigned: number, submitted: number, late: number, reviewed: number, pending: number, missing: number }
export interface ReviewRow { studentId: string, name: string, code: string, group: HomeworkGroup, submission: HomeworkSubmission | null }
/** Groups that still need something from the student, soonest first. */
export const needsAttention = (items: BoardItem[]) => items.filter(i => i.group === 'due-today' || i.group === 'upcoming' || i.group === 'missing').sort((a, b) => (a.dueDate + a.dueTime).localeCompare(b.dueDate + b.dueTime))
export const groupTone = (group: HomeworkGroup): 'neutral' | 'success' | 'warning' | 'danger' | 'primary' => group === 'missing' ? 'danger' : group === 'late' ? 'warning' : group === 'reviewed' || group === 'submitted' ? 'success' : group === 'due-today' ? 'primary' : 'neutral'
export const marksLabel = (submission: HomeworkSubmission | null, maxMarks: string) => submission?.grade ? submission.grade + (maxMarks ? ' / ' + maxMarks : '') : ''
/** A student may hand in (again) while the work is published, is done online and is not yet reviewed or excused. */
export const mayHandIn = (item: BoardItem) => item.status === 'Published' && studentSubmits(item.submissionMode) && item.submission?.status !== 'Reviewed' && item.submission?.outcome !== 'Excused'
/** What the student does with this assignment, in their words. */
export const handInLabel = (item: BoardItem) => item.submissionMode === 'Done' ? (item.submission ? 'Marked as done' : 'Mark as done') : item.submission ? 'Hand in again' : 'Hand in'
export const overviewTotals = (items: OverviewItem[]) => ({ toReview: items.reduce((n, i) => n + i.pending, 0), missing: items.reduce((n, i) => n + i.missing, 0), late: items.reduce((n, i) => n + i.late, 0), published: items.filter(i => i.status === 'Published').length })
export interface Submission { id: string, homeworkId: string, studentId: string, response: string, feedback: string, grade: string }
export interface Exam { id: string, name: string, classId: string, subjectId: string, date: string, maxMarks: string, passMarks: string, status: string }
// Exams & results: the lifecycle, the scheme an exam is marked by, the marksheet and the report card, as the server
// shapes them. The server decides who may enter or move what; these helpers only shape the screens and pre-check entries.
export type ExamStatus = 'Draft' | 'Scheduled' | 'MarksEntry' | 'Submitted' | 'Approved' | 'Published' | 'Closed'
export const EXAM_STATUSES: ExamStatus[] = ['Draft', 'Scheduled', 'MarksEntry', 'Submitted', 'Approved', 'Published', 'Closed']
export const EXAM_STATUS_LABEL: Record<ExamStatus, string> = { Draft: 'Draft', Scheduled: 'Scheduled', MarksEntry: 'Marks entry', Submitted: 'Awaiting approval', Approved: 'Approved', Published: 'Published', Closed: 'Closed' }
export const examTone = (status: ExamStatus): 'neutral' | 'success' | 'warning' | 'danger' | 'primary' => status === 'Published' ? 'success' : status === 'Approved' ? 'primary' : status === 'Submitted' || status === 'MarksEntry' ? 'warning' : 'neutral'
export interface Scheme { type: 'Marks' | 'Grade' | 'Components', max: number, passMarks: number | null, gradeOnly: boolean, components: { name: string, max: number, pass: number | null }[], grades: { label: string, minPercent: number }[] }
export interface TimetableExam { id: string, version: number, name: string, term: string, className: string, subjectName: string, date: string, startsAt: string, endsAt: string, room: string, instructions: string, schemeName: string, maxMarks: string, status: ExamStatus, resultsVisible: boolean, returnReason: string }
export interface ExamOverview extends TimetableExam { assigned: number, entered: number, missing: number, absent: number, exempt: number, average: number | null, passed: number, failed: number }
export type MarkStatus = 'Present' | 'Absent' | 'Exempt'
export const MARK_STATUSES: MarkStatus[] = ['Present', 'Absent', 'Exempt']
export interface SheetMark { id: string, version: number, status: MarkStatus, score: number | null, grade: string, pass: boolean, components: { name: string, max: number, score: number | null }[], remarks: string }
export interface SheetRow { studentId: string, name: string, code: string, mark: SheetMark | null }
export interface Marksheet { exam: TimetableExam, scheme: Scheme, students: SheetRow[], entered: number, canEdit: boolean, canSubmit: boolean, canReview: boolean }
export interface MarkEntry { status: MarkStatus, components: Record<string, string>, grade: string, remarks: string }
export const examTime = (exam: Pick<TimetableExam, 'startsAt' | 'endsAt'>) => exam.startsAt ? exam.startsAt + (exam.endsAt ? '–' + exam.endsAt : '') : ''
/** Upcoming exams soonest first and held exams most recent first, from the server's date order. */
export const splitExams = <T extends { date: string }>(items: T[], today: string) => ({ upcoming: items.filter(i => i.date >= today), held: items.filter(i => i.date < today).reverse() })
export const examsByDay = <T extends { date: string }>(items: T[]) => { const groups: { date: string, items: T[] }[] = []; for (const item of items) { const last = groups[groups.length - 1]; if (last && last.date === item.date) last.items.push(item); else groups.push({ date: item.date, items: [item] }) } return groups }
export const toMarkEntry = (row: SheetRow, scheme: Scheme): MarkEntry => { const components: Record<string, string> = {}; for (const c of scheme.components) { const f = row.mark?.components.find(x => x.name === c.name); components[c.name] = f?.score == null ? '' : String(f.score) } return { status: row.mark?.status ?? 'Present', components, grade: row.mark && scheme.gradeOnly ? row.mark.grade : '', remarks: row.mark?.remarks ?? '' } }
const num = (text: string) => { const t = text.trim(); if (t === '') return null; const v = Number(t); return Number.isFinite(v) ? v : NaN }
/** The total a present student would get; null while a component is still empty. */
export const markTotal = (entry: MarkEntry, scheme: Scheme): number | null => { if (entry.status !== 'Present' || scheme.gradeOnly) return null; let sum = 0; for (const c of scheme.components) { const v = num(entry.components[c.name] ?? ''); if (v === null || Number.isNaN(v)) return null; sum += v } return sum }
export const markGrade = (scheme: Scheme, percent: number) => scheme.grades.find(g => percent >= g.minPercent)?.label ?? scheme.grades[scheme.grades.length - 1]?.label ?? ''
/** What the server would refuse, said before the sheet is sent. */
export const markProblem = (entry: MarkEntry, scheme: Scheme): string | null => {
  if (entry.status !== 'Present') return null
  if (scheme.gradeOnly) return entry.grade.trim() === '' || scheme.grades.some(g => g.label.toLowerCase() === entry.grade.trim().toLowerCase()) ? null : 'Use one of ' + scheme.grades.map(g => g.label).join(', ')
  for (const c of scheme.components) { const v = num(entry.components[c.name] ?? ''); if (v === null) continue; if (Number.isNaN(v) || v < 0 || v > c.max) return (scheme.type === 'Marks' ? 'Marks' : c.name) + ' must be between 0 and ' + c.max }
  return null
}
const sameMark = (a: MarkEntry, b: MarkEntry) => a.status === b.status && a.grade.trim() === b.grade.trim() && a.remarks.trim() === b.remarks.trim() && Object.keys({ ...a.components, ...b.components }).every(k => (a.components[k] ?? '').trim() === (b.components[k] ?? '').trim())
/** The rows that changed and are complete, in the shape the marksheet call takes (a blank new row is not sent). */
export const changedMarks = (rows: SheetRow[], drafts: Record<string, MarkEntry>, scheme: Scheme) => rows.flatMap(row => {
  const draft = drafts[row.studentId]; if (!draft || sameMark(draft, toMarkEntry(row, scheme))) return []
  const blank = draft.status === 'Present' && (scheme.gradeOnly ? draft.grade.trim() === '' : scheme.components.every(c => (draft.components[c.name] ?? '').trim() === '')) && draft.remarks.trim() === ''
  if ((blank && !row.mark) || (draft.status === 'Present' && !scheme.gradeOnly && markTotal(draft, scheme) === null)) return []
  const components: Record<string, number> = {}; for (const c of scheme.components) { const v = num(draft.components[c.name] ?? ''); if (v !== null && !Number.isNaN(v)) components[c.name] = v }
  return [{ studentId: row.studentId, status: draft.status, components, grade: draft.grade.trim(), remarks: draft.remarks.trim(), version: row.mark?.version }]
})
export const markLabel = (mark: Pick<SheetMark, 'status' | 'score' | 'grade'> | null, scheme: Pick<Scheme, 'max' | 'gradeOnly'>) => !mark ? '' : mark.status === 'Absent' ? 'Absent' : mark.status === 'Exempt' ? 'Exempt' : scheme.gradeOnly ? mark.grade : mark.score == null ? '' : mark.score + ' / ' + scheme.max + (mark.grade ? ' · ' + mark.grade : '')
/** Leadership's figures: what waits for approval, what is still being entered, what is published. */
export const examTotals = (items: ExamOverview[]) => ({ exams: items.length, pendingApproval: items.filter(i => i.status === 'Submitted').length, entryIncomplete: items.filter(i => EXAM_STATUSES.indexOf(i.status) <= 2 && i.missing > 0).length, published: items.filter(i => i.resultsVisible).length, entered: items.reduce((n, i) => n + i.entered, 0), expected: items.reduce((n, i) => n + i.assigned, 0) })
/** The one stage move each role may make from a screen: a teacher submits, leadership approves, returns or publishes. */
export const examActions = (status: ExamStatus, who: { leadership: boolean, teacher: boolean, entered: number }): { to: ExamStatus, label: string, reason?: boolean }[] => {
  if (who.leadership) return status === 'Draft' ? [{ to: 'Scheduled', label: 'Schedule' }] : status === 'Scheduled' ? [{ to: 'MarksEntry', label: 'Open marks entry' }] : status === 'Submitted' ? [{ to: 'Approved', label: 'Approve' }, { to: 'MarksEntry', label: 'Return for correction', reason: true }] : status === 'Approved' ? [{ to: 'Published', label: 'Publish results' }, { to: 'MarksEntry', label: 'Return for correction', reason: true }] : []
  return who.teacher && (status === 'Draft' || status === 'Scheduled' || status === 'MarksEntry') && who.entered > 0 ? [{ to: 'Submitted', label: 'Submit for approval' }] : []
}
export interface Circular { id: string, title: string, message: string, audience: string, classId: string, dueDate: string, createdAt: string }
export interface CalendarEvent { id: string, title: string, startsOn: string, endsOn: string, description: string }
export interface Message { id: string, title: string, message: string, createdAt: string }
export interface Leave { id: string, version: number, teacherId: string, typeId: string, fromDate: string, toDate: string, halfDay: string, reason: string, status: string, approvalRemark: string, days?: number }
export interface Charge { id: string, studentId: string, student: string, description: string, dueDate: string, gross: number, concession: number, paid: number, balance: number, currency: string }
export interface RegisterRow { id: string, code: string, name: string, className: string, status: AttendanceStatus | '', reason?: string, remark?: string }
/** Structured reasons the school can record with Absent, Late or Excused. The list itself comes from the server; this is the fallback. */
export const REASONS = ['Sick', 'Approved leave', 'Transport delay', 'Medical', 'School activity', 'Family', 'Other']
export interface Reason { reason: string, remark: string }
export interface ClassRegister { className: string, expected: number, marked: number, present: number, absent: number, late: number, excused: number, state: string, teacher: string, submittedAt: string }
export interface RegisterTotals { expected: number, marked: number, present: number, absent: number, late: number, excused: number, completed: number, pending: number, percent: number }
export interface DayRecord { day: string, status: AttendanceStatus, reason: string, remark: string }
export interface ReportResult { exam: string, term: string, subject: string, status: MarkStatus, components: { name: string, max: number, score: number | null }[], score: number | null, maximum: number | null, grade: string, pass: boolean, remarks: string }
export interface ReportCard { results: ReportResult[], obtained: number, maximum: number, percent: number, grade: string, passed: number, failed: number, year: string, attendance: { percent: number | null, markedDays: number, present: number, absent: number, late: number } | null }
// Student 360: the one read model the server composes from the register, homework, exams, fees, documents and
// notices, with what the role may see already decided. These helpers only shape the screen.
export interface S360Summary { present: number, late: number, absent: number, excused: number, markedDays: number, percent: number | null }
export interface S360Event { at: string, kind: string, title: string, detail: string, source: string }
export interface S360Timeline { items: S360Event[], total: number, more: boolean, page: number, pageSize: number }
export interface Student360 {
  student: { id: string, name: string, admissionNumber: string, className: string, year: string, status: string, email: string, phone: string, dateOfBirth: string, guardians: { name: string, relationship: string, email: string }[] }
  visibility: { contact: boolean, fees: boolean, guardians: boolean, history: boolean }
  academics: { year: string, className: string, section: string, classTeacher: string, allocated: boolean, subjects: { subject: string, teacher: string }[] }
  attendance: { month: string, thisMonth: S360Summary, year: S360Summary, from: string, to: string, recent: { day: string, status: string, reason: string, remark: string }[] }
  homework: { assigned: number, counts: Record<string, number>, completion: number | null, due: { id: string, title: string, subject: string, dueDate: string, dueTime: string, group: string }[], feedback: { title: string, subject: string, grade: string, feedback: string, reviewedAt: string }[] }
  exams: { upcoming: { id: string, name: string, subjectName: string, date: string, startsAt: string, endsAt: string, room: string }[], published: number, obtained: number, maximum: number, percent: number, grade: string, passed: number, failed: number, latest: ReportResult[] }
  fees: { available: true, charges: number, applicable: number, paid: number, outstanding: number, overdue: number, currency: string, recentPayments: { id: string, receipt: string, amount: number, method: string, paidOn: string, description: string, currency: string }[] } | { available: false, reason: string }
  documents: { id: string, type: string, number: string, issuedOn: string, files: number }[]
  notices: { id: string, title: string, createdAt: string, dueDate: string }[]
  timeline: S360Timeline
}
export type S360Tab = 'overview' | 'academics' | 'attendance' | 'homework' | 'exams' | 'fees' | 'documents' | 'timeline'
export const S360_TAB_LABEL: Record<S360Tab, string> = { overview: 'Overview', academics: 'Academics', attendance: 'Attendance', homework: 'Homework', exams: 'Exams', fees: 'Fees', documents: 'Documents', timeline: 'Timeline' }
/** The sections a viewer gets: fees only where the role may see them. */
export const s360Tabs = (see: { fees: boolean }): S360Tab[] => ['overview', 'academics', 'attendance', 'homework', 'exams', ...(see.fees ? ['fees' as const] : []), 'documents', 'timeline']
/** "—" where nothing has been recorded, never a fake zero. */
export const pctLabel = (value: number | null | undefined) => value == null ? '—' : value + '%'
export const s360AttendanceNote = (s: S360Summary) => s.markedDays === 0 ? 'No days marked yet' : `${s.present + s.late} of ${s.markedDays} days attended`
export const s360HomeworkNote = (h: Student360['homework']) => h.assigned === 0 ? 'No homework set yet' : `${h.counts.missing ?? 0} missing · ${(h.counts['due-today'] ?? 0) + (h.counts.upcoming ?? 0)} due`
export const s360ExamsNote = (e: Student360['exams']) => e.published === 0 ? 'No published results yet' : `${e.passed} passed · ${e.failed} below pass`
export const s360FeesNote = (f: Student360['fees']) => !f.available ? f.reason : f.charges === 0 ? 'No fees charged yet' : f.outstanding > 0 ? `${f.overdue} overdue of ${f.charges} charges` : 'All charges settled'
export const s360EventsByDay = (events: S360Event[]) => { const groups: { day: string, events: S360Event[] }[] = []; for (const e of events) { const day = e.at.slice(0, 10); const last = groups[groups.length - 1]; if (last && last.day === day) last.events.push(e); else groups.push({ day, events: [e] }) } return groups }
export const s360EventIcon = (kind: string) => kind === 'attendance' ? 'checkbox-outline' : kind === 'homework' ? 'book-outline' : kind === 'exam' || kind === 'result' ? 'school-outline' : kind === 'fee' || kind === 'payment' ? 'wallet-outline' : 'document-text-outline'
/** "Theory 56/70 · Practical 25/30" when an exam has components; nothing for plain marks. */
export const componentsLabel = (components: { name: string, max: number, score: number | null }[]) => components.length > 1 ? components.map(c => c.name + ' ' + (c.score ?? '—') + '/' + c.max).join(' · ') : ''
export const resultLabel = (r: ReportResult) => r.status === 'Absent' ? 'Absent' : r.status === 'Exempt' ? 'Exempt' : r.maximum == null ? r.grade || '—' : r.score + ' / ' + r.maximum

const day = (value: string) => String(value ?? '').slice(0, 10)

/** Homework split around today: what is still due (soonest first) and what has passed (most recent first). */
export function splitHomework<T extends { dueDate: string }>(items: T[], today: string): { upcoming: T[], past: T[] } {
  const sorted = [...items].sort((a, b) => day(a.dueDate).localeCompare(day(b.dueDate)))
  return { upcoming: sorted.filter(item => day(item.dueDate) >= today), past: sorted.filter(item => day(item.dueDate) < today).reverse() }
}
/** Events that have not ended yet, soonest first. */
export function upcomingEvents<T extends { startsOn: string, endsOn: string }>(events: T[], today: string): T[] {
  return events.filter(event => day(event.endsOn || event.startsOn) >= today).sort((a, b) => day(a.startsOn).localeCompare(day(b.startsOn)))
}
export const newestFirst = <T extends { createdAt: string }>(items: T[]) => [...items].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))

// Fees 2.0: the ledger the server composes for one student (totals, every instalment with its state, payments and
// receipts) and the office summary. The app never adds figures up; it only lays the server's figures out.
export type ChargeState = 'Unpaid' | 'Partial' | 'Paid' | 'Overdue' | 'Waived' | 'Cancelled'
export interface LedgerCharge { id: string, description: string, dueDate: string, net: number, paid: number, outstanding: number, state: ChargeState, overdue: boolean, currency: string }
export interface LedgerTotals { charges: number, applicable: number, concessions: number, net: number, paid: number, outstanding: number, overdue: number, overdueCount: number, currency: string }
export interface LedgerPayment { id: string, receipt: string, amount: number, method: string, reference: string, status: 'Completed' | 'Reversed', source: 'manual' | 'online', paidOn: string, description: string, currency: string, reversalReason: string }
export interface StudentLedger { student: { id: string, name: string, admissionNumber: string, class: string }, totals: LedgerTotals, charges: LedgerCharge[], payments: { items: LedgerPayment[], total: number, more: boolean }, online: { enabled: boolean, provider: string } }
export interface FeeSummary { collectedToday: number, collectedThisMonth: number, reversalsThisMonth: number, totals: LedgerTotals, byClass: { class: string, outstanding: number, overdue: number, paid: number }[], recent: { id: string, receipt: string, amount: number, method: string, status: string, paidOn: string, student: string, currency: string }[] }
export const STATE_LABEL: Record<ChargeState, string> = { Unpaid: 'Unpaid', Partial: 'Part paid', Paid: 'Paid', Overdue: 'Overdue', Waived: 'Waived', Cancelled: 'Cancelled' }
export const stateTone = (state: ChargeState): 'neutral' | 'success' | 'warning' | 'danger' | 'primary' => state === 'Paid' ? 'success' : state === 'Overdue' ? 'danger' : state === 'Partial' ? 'warning' : 'neutral'
/** Instalments still open: overdue first, then soonest due. Settled, waived and cancelled ones are not due. */
export const dueCharges = (charges: LedgerCharge[]) => charges.filter(c => c.outstanding > 0 && c.state !== 'Waived' && c.state !== 'Cancelled').sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.dueDate.localeCompare(b.dueDate))
export const ledgerNote = (t: LedgerTotals) => t.charges === 0 ? 'No fees charged yet' : t.outstanding > 0 ? `${t.overdueCount} overdue of ${t.charges} charges` : 'All charges settled'
/** Totals exactly as the web fee summary computes them: billed is after concessions. */
export function feeTotals(charges: Charge[]) {
  const sum = (pick: (charge: Charge) => number) => charges.reduce((total, charge) => total + (Number(pick(charge)) || 0), 0)
  return { billed: sum(c => c.gross - c.concession), paid: sum(c => c.paid), balance: sum(c => c.balance), outstanding: charges.filter(c => c.balance > 0).length, count: charges.length, currency: charges[0]?.currency ?? '' }
}
export const money = (currency: string, value: number) => `${currency ? currency + ' ' : ''}${(Number(value) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** The register as it will look once the unsaved choices are applied. */
export function registerSummary(rows: RegisterRow[], draft: Record<string, AttendanceStatus> = {}) {
  const counts = { Present: 0, Late: 0, Absent: 0, Excused: 0, unmarked: 0, total: rows.length }
  for (const row of rows) { const status = draft[row.id] ?? row.status; if (status) counts[status]++; else counts.unmarked++ }
  return counts
}
/** Only the entries that differ from what is saved are sent. */
export function registerChanges(rows: RegisterRow[], draft: Record<string, AttendanceStatus>): { studentId: string, status: AttendanceStatus }[] {
  return rows.filter(row => draft[row.id] && draft[row.id] !== row.status).map(row => ({ studentId: row.id, status: draft[row.id] }))
}
/** Every student without a saved or chosen status becomes Present; choices already made are kept. */
export function markRestPresent(rows: RegisterRow[], draft: Record<string, AttendanceStatus>): Record<string, AttendanceStatus> {
  const next = { ...draft }
  for (const row of rows) if (!row.status && !next[row.id]) next[row.id] = 'Present'
  return next
}
/** A reason can accompany Absent, Late or Excused; Present never carries one. */
export const mayHaveReason = (status: AttendanceStatus | '') => status === 'Absent' || status === 'Late' || status === 'Excused'
/** What is sent: every changed status, with the reason chosen for it (or the saved one) when the status can carry one. */
export function registerEntries(rows: RegisterRow[], draft: Record<string, AttendanceStatus>, reasons: Record<string, Reason> = {}) {
  return rows.flatMap(row => {
    const status = draft[row.id]; if (!status) return []
    const chosen = reasons[row.id], reason = mayHaveReason(status) ? (chosen?.reason ?? row.reason ?? '') : '', remark = mayHaveReason(status) ? (chosen?.remark ?? row.remark ?? '') : ''
    if (status === row.status && reason === (row.reason ?? '') && remark === (row.remark ?? '')) return []
    return [{ studentId: row.id, status, reason, remark }]
  })
}
/** Classes whose register was submitted: the next change to them is a correction and needs a reason. */
export const submittedClasses = (registers: ClassRegister[]) => new Set(registers.filter(r => r.state === 'Submitted' || r.state === 'Corrected').map(r => r.className))
export const isCorrection = (rows: RegisterRow[], draft: Record<string, AttendanceStatus>, submitted: Set<string>) => registerEntries(rows, draft).some(e => submitted.has(rows.find(r => r.id === e.studentId)?.className ?? ''))
export const registerDone = (state: string) => state === 'Submitted' || state === 'Corrected'
export const classesOf = (rows: RegisterRow[]) => [...new Set(rows.map(row => row.className).filter(Boolean))].sort()

/** Inclusive number of days in a leave request, or 0 when the dates are not usable. */
export function leaveDays(fromDate: string, toDate: string) {
  const from = Date.parse(day(fromDate) + 'T00:00:00Z'), to = Date.parse(day(toDate) + 'T00:00:00Z')
  return Number.isFinite(from) && Number.isFinite(to) && to >= from ? Math.round((to - from) / 86_400_000) + 1 : 0
}
/** yyyy-MM-dd moved by a number of days. */
export function shiftDay(value: string, by: number) {
  const date = new Date(day(value) + 'T00:00:00Z'); date.setUTCDate(date.getUTCDate() + by)
  return date.toISOString().slice(0, 10)
}
/** The last `count` days ending today, oldest first, for a horizontal day picker. */
export const recentDays = (today: string, count: number) => Array.from({ length: count }, (_, i) => shiftDay(today, i - count + 1))
/** Calendar days inclusive; a half day is half of one. The server's figure is the one of record. */
export const leaveDaysOf = (fromDate: string, toDate: string, halfDay = 'No') => halfDay === 'First half' || halfDay === 'Second half' ? 0.5 : leaveDays(fromDate, toDate)
