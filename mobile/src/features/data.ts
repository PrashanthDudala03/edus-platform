import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { can } from '@/access/experience'
import { api, useSession } from '@/services'
import { isoMonth } from '@/utils/format'
import type { Candidate, Operations, Period, Substitution, TimetableDay } from './timetable'
import type { AdmissionDetail, AdmissionPipeline } from './admissions'
import type { Assignment, AttendanceStatus, BoardItem, CalendarEvent, Charge, ChargeState, Child, Circular, ClassRegister, DayRecord, Exam, ExamOverview, ExamStatus, FeeSummary, LedgerTotals, StudentLedger, Homework, HomeworkGroup, HomeworkSubmission, Leave, MarkStatus, Marksheet, Message, OverviewItem, RegisterRow, RegisterTotals, ReportCard, ReportResult, ReviewRow, S360Timeline, Scheme, SheetMark, Student360, Submission, TimetableExam } from './logic'

// Every request the core modules make, in one place. Each is an existing EduOS endpoint that already limits rows to
// what the signed-in account may see; the app adds no filter that could be mistaken for access control. A query is
// only enabled when the account holds the permission the endpoint requires, so no request is made just to be refused.
type Row = Record<string, unknown>
const s = (value: unknown) => (value === null || value === undefined ? '' : String(value))
const n = (value: unknown) => Number(value) || 0
const get = async <T>(path: string, params?: Record<string, unknown>) => (await api.get(path, { params })).data.data as T
export const usePermission = (permission: string) => useSession(state => can(state.user, permission))

/** All records of a kind the account may read. The API serves 20 a page with no "all" option, so pages are read in turn. */
const MAX_PAGES = 10
async function allRecords(kind: string): Promise<Row[]> {
  const rows: Row[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await get<{ data: Row[], totalCount: number }>('/suite/records/' + kind, { page })
    rows.push(...result.data)
    if (result.data.length === 0 || rows.length >= n(result.totalCount)) break
  }
  return rows
}
function useRecords<T>(kind: string, shape: (row: Row) => T, enabled = true) {
  const allowed = usePermission(kind + '.view')
  return useQuery({ queryKey: ['records', kind], enabled: enabled && allowed, staleTime: 60_000, queryFn: async () => (await allRecords(kind)).map(shape) })
}
export const useHomework = (enabled = true) => useRecords<Homework>('homework', r => ({ id: s(r.id), title: s(r.title), classId: s(r.classId), subjectId: s(r.subjectId), dueDate: s(r.dueDate).slice(0, 10), instructions: s(r.instructions) }), enabled)
export const useSubmissions = (enabled = true) => useRecords<Submission>('submissions', r => ({ id: s(r.id), homeworkId: s(r.homeworkId), studentId: s(r.studentId), response: s(r.response), feedback: s(r.feedback), grade: s(r.grade) }), enabled)
export const useExams = (enabled = true) => useRecords<Exam>('exams', r => ({ id: s(r.id), name: s(r.name), classId: s(r.classId), subjectId: s(r.subjectId), date: s(r.date).slice(0, 10), maxMarks: s(r.maxMarks), passMarks: s(r.passMarks), status: s(r.status) }), enabled)
export const useCirculars = (enabled = true) => useRecords<Circular>('circulars', r => ({ id: s(r.id), title: s(r.title), message: s(r.message), audience: s(r.audience), classId: s(r.classId), dueDate: s(r.dueDate).slice(0, 10), createdAt: s(r.createdAt) }), enabled)
export const useCalendar = (enabled = true) => useRecords<CalendarEvent>('calendar', r => ({ id: s(r.id), title: s(r.title), startsOn: s(r.startsOn).slice(0, 10), endsOn: s(r.endsOn).slice(0, 10), description: s(r.description) }), enabled)
export const useMessages = (enabled = true) => useRecords<Message>('messages', r => ({ id: s(r.id), title: s(r.title), message: s(r.message), createdAt: s(r.createdAt) }), enabled)
export const useLeave = (enabled = true) => useRecords<Leave>('leave-requests', r => ({ id: s(r.id), version: n(r.version), teacherId: s(r.teacherId), typeId: s(r.typeId), halfDay: s(r.halfDay) || 'No', days: r.days === undefined || r.days === null ? undefined : n(r.days), fromDate: s(r.fromDate).slice(0, 10), toDate: s(r.toDate).slice(0, 10), reason: s(r.reason), status: s(r.status), approvalRemark: s(r.approvalRemark) }), enabled)

type Options = Record<string, { id: string, label: string }[] | undefined>
/** Names for the ids in records (subjects, classes, teachers, students, exams), from the existing options call. */
export function useNames(enabled = true) {
  const options = useQuery({ queryKey: ['suite-options'], enabled, staleTime: 10 * 60_000, queryFn: () => get<Options>('/suite/options') })
  const name = (source: string, id: string) => options.data?.[source]?.find(option => option.id === id)?.label ?? ''
  return Object.assign(name, { list: (source: string) => options.data?.[source] ?? [], ready: options.isSuccess })
}

/**
 * The students linked to this account (a parent's children, or the student themself) with this month's attendance.
 * The attendance report lists every linked student; the class allocation adds the class id where one exists.
 */
export function useChildren(month = isoMonth(new Date()), enabled = true) {
  const allowed = usePermission('reports.view'), mayAllocations = usePermission('allocations.view')
  const allocations = useQuery({ queryKey: ['allocations'], enabled: enabled && allowed && mayAllocations, staleTime: 5 * 60_000, queryFn: () => get<Row[]>('/suite/allocations') })
  const report = useQuery({ queryKey: ['attendance-report', month], enabled: enabled && allowed, staleTime: 60_000, queryFn: () => get<Row[]>('/suite/reports/attendance', { month }) })
  const data: Child[] | undefined = report.data?.map(r => ({ studentId: s(r.studentId), name: s(r.name), className: s(r.class), admissionNumber: s(r.admissionNumber),
    classId: s(allocations.data?.find(a => s(a.studentId) === s(r.studentId))?.classId), present: n(r.present), absent: n(r.absent), late: n(r.late), excused: n(r.excused), markedDays: n(r.markedDays) }))
  return { ...report, data, allowed }
}
export function useReportCard(studentId: string | undefined) {
  const allowed = usePermission('reports.view')
  return useQuery({ queryKey: ['report-card', studentId], enabled: allowed && !!studentId, staleTime: 60_000, queryFn: async (): Promise<ReportCard> => {
    const card = await get<Row>('/suite/report-cards/' + studentId), att = card.attendance as Row | null
    return { obtained: n(card.obtained), maximum: n(card.maximum), percent: n(card.percent), grade: s(card.grade), passed: n(card.passed), failed: n(card.failed), year: s(card.year),
      attendance: att ? { percent: att.percent == null ? null : n(att.percent), markedDays: n(att.markedDays), present: n(att.present), absent: n(att.absent), late: n(att.late) } : null,
      results: (Array.isArray(card.results) ? card.results as Row[] : []).map((r): ReportResult => ({ exam: s(r.exam), term: s(r.term), subject: s(r.subject), status: markStatus(r.status), components: components(r.components), score: r.score == null ? null : n(r.score), maximum: r.maximum == null ? null : n(r.maximum), grade: s(r.grade), pass: r.pass === true, remarks: s(r.remarks) })) }
  } })
}
const markStatus = (v: unknown): MarkStatus => v === 'Absent' || v === 'Exempt' ? v : 'Present'
const components = (v: unknown) => (Array.isArray(v) ? v as Row[] : []).map(c => ({ name: s(c.name), max: n(c.max), score: c.score == null ? null : n(c.score) }))
const examStatus = (v: unknown): ExamStatus => (['Draft', 'Scheduled', 'MarksEntry', 'Submitted', 'Approved', 'Published', 'Closed'].includes(s(v)) ? s(v) : 'Draft') as ExamStatus
const timetableExam = (r: Row): TimetableExam => ({ id: s(r.id), version: n(r.version), name: s(r.name), term: s(r.term), className: s(r.className), subjectName: s(r.subjectName), date: s(r.date).slice(0, 10), startsAt: s(r.startsAt), endsAt: s(r.endsAt), room: s(r.room), instructions: s(r.instructions), schemeName: s(r.schemeName), maxMarks: s(r.maxMarks), status: examStatus(r.status), resultsVisible: r.resultsVisible === true, returnReason: s(r.returnReason) })
const scheme = (r: Row): Scheme => ({ type: (['Marks', 'Grade', 'Components'].includes(s(r.type)) ? s(r.type) : 'Marks') as Scheme['type'], max: n(r.max), passMarks: r.passMarks == null ? null : n(r.passMarks), gradeOnly: r.gradeOnly === true, components: (Array.isArray(r.components) ? r.components as Row[] : []).map(c => ({ name: s(c.name), max: n(c.max), pass: c.pass == null ? null : n(c.pass) })), grades: (Array.isArray(r.grades) ? r.grades as Row[] : []).map(g => ({ label: s(g.label), minPercent: n(g.minPercent) })) })
const sheetMark = (r: unknown): SheetMark | null => { if (!r || typeof r !== 'object') return null; const m = r as Row; return { id: s(m.id), version: n(m.version), status: markStatus(m.status), score: m.score == null ? null : n(m.score), grade: s(m.grade), pass: m.pass === true, components: components(m.components), remarks: s(m.remarks) } }
/** The exam timetable the account may see: scheduled exams for families, every stage for staff. */
export function useExamTimetable(enabled = true) {
  const allowed = usePermission('exams.view')
  return useQuery({ queryKey: ['exam-timetable'], enabled: enabled && allowed, staleTime: 60_000, queryFn: async (): Promise<{ items: TimetableExam[], today: string }> => { const d = await get<Row>('/suite/exams/timetable'); return { items: (Array.isArray(d.items) ? d.items as Row[] : []).map(timetableExam), today: s(d.today) } } })
}
/** Every exam a teacher or leadership manages, with how marks entry is going. */
export function useExamOverview(enabled = true) {
  const allowed = usePermission('exams.view')
  return useQuery({ queryKey: ['exam-overview'], enabled: enabled && allowed, staleTime: 30_000, queryFn: async (): Promise<ExamOverview[]> => { const d = await get<Row>('/suite/exams/overview'); return (Array.isArray(d.items) ? d.items as Row[] : []).map(r => ({ ...timetableExam(r), assigned: n(r.assigned), entered: n(r.entered), missing: n(r.missing), absent: n(r.absent), exempt: n(r.exempt), average: r.average == null ? null : n(r.average), passed: n(r.passed), failed: n(r.failed) })) } })
}
export function useMarksheet(examId: string | undefined) {
  return useQuery({ queryKey: ['marksheet', examId], enabled: !!examId, staleTime: 15_000, queryFn: async (): Promise<Marksheet> => { const d = await get<Row>('/suite/exams/' + examId + '/marksheet')
    return { exam: timetableExam(d.exam as Row), scheme: scheme(d.scheme as Row), students: (Array.isArray(d.students) ? d.students as Row[] : []).map(r => ({ studentId: s(r.studentId), name: s(r.name), code: s(r.code), mark: sheetMark(r.mark) })), entered: n(d.entered), canEdit: d.canEdit === true, canSubmit: d.canSubmit === true, canReview: d.canReview === true } } })
}
/** Student 360: one request composes the whole picture; the server limits it to the caller's own students. */
export function useStudent360(studentId: string | undefined) {
  const allowed = usePermission('reports.view')
  return useQuery({ queryKey: ['student360', studentId], enabled: allowed && !!studentId, staleTime: 30_000, queryFn: () => get<Student360>('/suite/students/' + studentId + '/360') })
}
export function useStudent360Timeline(studentId: string | undefined, page: number, pageSize = 20) {
  return useQuery({ queryKey: ['student360-timeline', studentId, page, pageSize], enabled: !!studentId && page > 1, staleTime: 30_000, queryFn: () => get<S360Timeline>('/suite/students/' + studentId + '/360/timeline', { page, pageSize }) })
}
const examKeys = ['exam-timetable', 'exam-overview', 'marksheet', 'report-card', 'records']
/** Saves changed rows (every row goes through the ordinary marks save on the server) and, if asked, submits the sheet. */
export function useSaveMarksheet() {
  const cache = useQueryClient()
  return useMutation({ mutationFn: async (input: { examId: string, entries: { studentId: string, status: MarkStatus, components: Record<string, number>, grade: string, remarks: string, version?: number }[], submit: boolean }) =>
    (await api.post(`/suite/exams/${input.examId}/marksheet`, { entries: input.entries, submit: input.submit })).data.data as { saved: number, errors: { studentId: string, message: string }[], status: string },
    onSuccess: () => Promise.all(examKeys.map(k => cache.invalidateQueries({ queryKey: [k] }))) })
}
/** One stage move: the server decides whether this account may make it. */
export function useExamTransition() {
  const cache = useQueryClient()
  return useMutation({ mutationFn: (input: { examId: string, to: ExamStatus, reason?: string, version?: number }) => api.post(`/suite/exams/${input.examId}/transition`, { to: input.to, reason: input.reason ?? '', version: input.version }),
    onSuccess: () => Promise.all(examKeys.map(k => cache.invalidateQueries({ queryKey: [k] }))) })
}
export function useFees(enabled = true) {
  const allowed = usePermission('fees.view')
  return useQuery({ queryKey: ['fees'], enabled: enabled && allowed, staleTime: 60_000, queryFn: async (): Promise<Charge[]> => (await get<Row[]>('/suite/fees')).map(r => ({ id: s(r.id), studentId: s(r.studentId), student: s(r.student), description: s(r.description),
    dueDate: s(r.dueDate).slice(0, 10), gross: n(r.gross), concession: n(r.concession), paid: n(r.paid), balance: n(r.balance), currency: s(r.currency) })) })
}
const ledgerTotals = (t: Row): LedgerTotals => ({ charges: n(t.charges), applicable: n(t.applicable), concessions: n(t.concessions), net: n(t.net), paid: n(t.paid), outstanding: n(t.outstanding), overdue: n(t.overdue), overdueCount: n(t.overdueCount), currency: s(t.currency) })
/** One student's fee ledger from the server: totals, instalments with their state, payments and receipts. Families get their own students only. */
export function useStudentLedger(studentId: string | undefined, page = 1) {
  const allowed = usePermission('fees.view')
  return useQuery({ queryKey: ['fee-ledger', studentId, page], enabled: allowed && !!studentId, staleTime: 30_000, queryFn: async (): Promise<StudentLedger> => {
    const d = await get<Row>('/suite/fees/ledger/' + studentId, { page, pageSize: 20 }); const st = (d.student ?? {}) as Row, pay = (d.payments ?? {}) as Row, online = (d.online ?? {}) as Row
    return { student: { id: s(st.id), name: s(st.name), admissionNumber: s(st.admissionNumber), class: s(st.class) }, totals: ledgerTotals((d.totals ?? {}) as Row),
      charges: (Array.isArray(d.charges) ? d.charges as Row[] : []).map(c => ({ id: s(c.id), description: s(c.description), dueDate: s(c.dueDate).slice(0, 10), net: n(c.net), paid: n(c.paid), outstanding: n(c.outstanding), state: (s(c.state) || 'Unpaid') as ChargeState, overdue: c.overdue === true, currency: s(c.currency) })),
      payments: { items: (Array.isArray(pay.items) ? pay.items as Row[] : []).map(p => ({ id: s(p.id), receipt: s(p.receipt), amount: n(p.amount), method: s(p.method), reference: s(p.reference), status: s(p.status) === 'Reversed' ? 'Reversed' : 'Completed', source: s(p.source) === 'online' ? 'online' : 'manual', paidOn: s(p.paidOn).slice(0, 10), description: s(p.description), currency: s(p.currency), reversalReason: s(p.reversalReason) })), total: n(pay.total), more: pay.more === true },
      online: { enabled: online.enabled === true, provider: s(online.provider) } }
  } })
}
/** The office summary: collected today and this month, outstanding, overdue, dues by class, recent payments. Leadership only. */
export function useFeeSummary(enabled = true) {
  const allowed = usePermission('fees.view')
  return useQuery({ queryKey: ['fee-summary'], enabled: enabled && allowed, staleTime: 60_000, queryFn: async (): Promise<FeeSummary> => {
    const d = await get<Row>('/suite/fees/summary')
    return { collectedToday: n(d.collectedToday), collectedThisMonth: n(d.collectedThisMonth), reversalsThisMonth: n(d.reversalsThisMonth), totals: ledgerTotals((d.totals ?? {}) as Row),
      byClass: (Array.isArray(d.byClass) ? d.byClass as Row[] : []).map(r => ({ class: s(r.class), outstanding: n(r.outstanding), overdue: n(r.overdue), paid: n(r.paid) })),
      recent: (Array.isArray(d.recent) ? d.recent as Row[] : []).map(p => ({ id: s(p.id), receipt: s(p.receipt), amount: n(p.amount), method: s(p.method), status: s(p.status), paidOn: s(p.paidOn).slice(0, 10), student: s(p.student), currency: s(p.currency) })) }
  } })
}
/** The daily register for the students this account teaches (or the whole school for leadership). */
export function useRegister(day: string, enabled = true) {
  const allowed = usePermission('attendance.view')
  return useQuery({ queryKey: ['register', day], enabled: enabled && allowed, staleTime: 30_000, queryFn: async (): Promise<RegisterRow[]> => (await get<Row[]>('/suite/student-attendance', { day })).map(r => ({ id: s(r.id), code: s(r.code), name: s(r.name), className: s(r.class), status: s(r.status) as RegisterRow['status'], reason: s(r.reason), remark: s(r.remark) })) })
}
/** Which classes have completed the day's register, with the day's totals. Leadership sees the school; a teacher their classes. */
export function useRegisters(day: string, enabled = true) {
  const allowed = usePermission('attendance.view')
  return useQuery({ queryKey: ['registers', day], enabled: enabled && allowed, staleTime: 30_000, queryFn: async (): Promise<{ totals: RegisterTotals, classes: ClassRegister[], reasons: string[] }> => {
    const d = await get<Row>('/suite/student-attendance/registers', { day }), t = (d.totals ?? {}) as Row
    return { totals: { expected: n(t.expected), marked: n(t.marked), present: n(t.present), absent: n(t.absent), late: n(t.late), excused: n(t.excused), completed: n(t.completed), pending: n(t.pending), percent: n(t.percent) },
      classes: (Array.isArray(d.classes) ? d.classes as Row[] : []).map(r => ({ className: s(r.className), expected: n(r.expected), marked: n(r.marked), present: n(r.present), absent: n(r.absent), late: n(r.late), excused: n(r.excused), state: s(r.state), teacher: s(r.teacher), submittedAt: s(r.submittedAt) })),
      reasons: Array.isArray(d.reasons) ? (d.reasons as unknown[]).map(s) : [] }
  } })
}
/** One student's marked days in a month, with the reason the school recorded. The server limits it to linked students. */
export function useAttendanceDays(studentId: string, month: string, enabled = true) {
  const allowed = usePermission('reports.view')
  return useQuery({ queryKey: ['attendance-days', studentId, month], enabled: enabled && allowed && !!studentId, staleTime: 60_000, queryFn: async (): Promise<DayRecord[]> => {
    const d = await get<Row>('/suite/reports/attendance/days', { studentId, month })
    return (Array.isArray(d.days) ? d.days as Row[] : []).map(r => ({ day: s(r.day).slice(0, 10), status: s(r.status) as AttendanceStatus, reason: s(r.reason), remark: s(r.remark) }))
  } })
}

// Writes. Each one is an action the same account can already take on the web; the server validates and authorises it.
export function useSaveRegister(day: string) {
  const cache = useQueryClient()
  return useMutation({ mutationFn: async (input: { entries: { studentId: string, status: AttendanceStatus, reason?: string, remark?: string }[], submit?: boolean, reason?: string, remark?: string }) => (await api.post('/suite/student-attendance', { day, ...input })).data as { message?: string },
    onSuccess: () => Promise.all([cache.invalidateQueries({ queryKey: ['register', day] }), cache.invalidateQueries({ queryKey: ['registers', day] }), cache.invalidateQueries({ queryKey: ['operations-overview'] }), cache.invalidateQueries({ queryKey: ['attendance-report'] }), cache.invalidateQueries({ queryKey: ['attendance-days'] })]) })
}
export function useAcknowledge() { return useMutation({ mutationFn: (circularId: string) => api.post(`/suite/circulars/${circularId}/acknowledge`) }) }
const assignment = (r: Row): Assignment => ({ id: s(r.id), title: s(r.title), className: s(r.className), subjectName: s(r.subjectName), teacher: s(r.teacher), instructions: s(r.instructions), dueDate: s(r.dueDate).slice(0, 10), dueTime: s(r.dueTime), maxMarks: s(r.maxMarks), submissionMode: (['None', 'Done', 'Text', 'File', 'Physical'].includes(s(r.submissionMode)) ? s(r.submissionMode) : 'Text') as Assignment['submissionMode'], status: (s(r.status) || 'Published') as Assignment['status'], attachments: n(r.attachments) })
const submission = (r: unknown): HomeworkSubmission | null => { if (!r || typeof r !== 'object') return null; const x = r as Row; return { id: s(x.id), version: n(x.version), status: s(x.status) === 'Reviewed' ? 'Reviewed' : s(x.status) === 'Submitted' ? 'Submitted' : '', submittedAt: s(x.submittedAt), late: x.late === true, outcome: (['Completed', 'Late', 'Missing', 'Excused'].includes(s(x.outcome)) ? s(x.outcome) : '') as HomeworkSubmission['outcome'], response: s(x.response), grade: s(x.grade), feedback: s(x.feedback), resubmissions: n(x.resubmissions), attachments: n(x.attachments) } }
/** One student's assignments with their state (due today, upcoming, submitted, reviewed, late, missing). The server limits it to linked students. */
export function useHomeworkBoard(studentId: string | undefined, enabled = true) {
  const allowed = usePermission('homework.view')
  return useQuery({ queryKey: ['homework-board', studentId], enabled: enabled && allowed && !!studentId, staleTime: 30_000, queryFn: async (): Promise<BoardItem[]> => {
    const d = await get<Row>('/suite/homework/board', { studentId })
    return (Array.isArray(d.items) ? d.items as Row[] : []).map(r => ({ ...assignment(r), group: s(r.group) as HomeworkGroup, submission: submission(r.submission) }))
  } })
}
/** Every assignment a teacher (or leadership) manages, with how the class is doing. */
export function useHomeworkOverview(enabled = true) {
  const allowed = usePermission('homework.view')
  return useQuery({ queryKey: ['homework-overview'], enabled: enabled && allowed, staleTime: 30_000, queryFn: async (): Promise<OverviewItem[]> => {
    const d = await get<Row>('/suite/homework/overview')
    return (Array.isArray(d.items) ? d.items as Row[] : []).map(r => ({ ...assignment(r), assigned: n(r.assigned), submitted: n(r.submitted), late: n(r.late), reviewed: n(r.reviewed), pending: n(r.pending), missing: n(r.missing) }))
  } })
}
/** The review list for one assignment: every student of the class and what they handed in. */
export function useHomeworkReview(homeworkId: string | undefined) {
  return useQuery({ queryKey: ['homework-review', homeworkId], enabled: !!homeworkId, staleTime: 15_000, queryFn: async (): Promise<ReviewRow[]> => {
    const d = await get<Row>('/suite/homework/' + homeworkId + '/submissions')
    return (Array.isArray(d.students) ? d.students as Row[] : []).map(r => ({ studentId: s(r.studentId), name: s(r.name), code: s(r.code), group: s(r.group) as HomeworkGroup, submission: submission(r.submission) }))
  } })
}
export function useReviewHomework() {
  const cache = useQueryClient()
  return useMutation({ mutationFn: (input: { homeworkId: string, studentId: string, grade: string, feedback: string, version: number }) => api.put(`/suite/homework/${input.homeworkId}/review/${input.studentId}`, { grade: input.grade, feedback: input.feedback, version: input.version }),
    onSuccess: (_, input) => Promise.all([cache.invalidateQueries({ queryKey: ['homework-review', input.homeworkId] }), cache.invalidateQueries({ queryKey: ['homework-overview'] })]) })
}
/** The quick check for notebook and in-class work: Completed, Late, Missing or Excused per student; '' clears it. */
export function useVerifyHomework() {
  const cache = useQueryClient()
  return useMutation({ mutationFn: (input: { homeworkId: string, studentId: string, outcome: string, version?: number }) => api.put(`/suite/homework/${input.homeworkId}/verify/${input.studentId}`, { outcome: input.outcome, version: input.version }),
    onSuccess: (_, input) => Promise.all([cache.invalidateQueries({ queryKey: ['homework-review', input.homeworkId] }), cache.invalidateQueries({ queryKey: ['homework-overview'] })]) })
}
/** Handing in: a first submission is created; handing in again updates it and the server keeps the earlier work. */
export function useHandIn() {
  const cache = useQueryClient()
  return useMutation({ mutationFn: async (input: { item: BoardItem, studentId: string, response: string }): Promise<unknown> => input.item.submission
    ? api.put('/suite/records/submissions/' + input.item.submission.id, { homeworkId: input.item.id, studentId: input.studentId, response: input.response, feedback: input.item.submission.feedback, grade: input.item.submission.grade, version: input.item.submission.version })
    : api.post('/suite/records/submissions', { homeworkId: input.item.id, studentId: input.studentId, response: input.response, feedback: '', grade: '' }),
    onSuccess: () => Promise.all([cache.invalidateQueries({ queryKey: ['homework-board'] }), cache.invalidateQueries({ queryKey: ['records', 'submissions'] })]) })
}
export function useSubmitHomework() {
  const cache = useQueryClient()
  return useMutation({ mutationFn: (input: { homeworkId: string, studentId: string, response: string }) => api.post('/suite/records/submissions', { ...input, feedback: '', grade: '' }), onSuccess: () => cache.invalidateQueries({ queryKey: ['records', 'submissions'] }) })
}
export function useRequestLeave() {
  const cache = useQueryClient()
  return useMutation({ mutationFn: (input: { teacherId: string, typeId: string, fromDate: string, toDate: string, halfDay: string, reason: string }) => api.post('/suite/records/leave-requests', { ...input, status: 'Pending', approvalRemark: '' }), onSuccess: () => { cache.invalidateQueries({ queryKey: ['records', 'leave-requests'] }); cache.invalidateQueries({ queryKey: ['leave'] }) } })
}
/** Approve or reject through the decision call, which needs the approve permission. The record's version is sent, so a request someone else already decided is refused, not overwritten. */
export function useDecideLeave() {
  const cache = useQueryClient()
  return useMutation({ mutationFn: ({ id, version, decision, remark }: { id: string, version: number, decision: 'Approved' | 'Rejected', remark: string }) => api.post('/suite/leave/' + id + '/decision', { decision, remark, version }),
    onSettled: () => { cache.invalidateQueries({ queryKey: ['records', 'leave-requests'] }); cache.invalidateQueries({ queryKey: ['leave'] }); cache.invalidateQueries({ queryKey: ['timetable'] }) } })
}
/** A staff member withdraws a pending request (leadership may cancel approved leave with a remark). */
export function useCancelLeave() {
  const cache = useQueryClient()
  return useMutation({ mutationFn: ({ leave, remark = '' }: { leave: Leave, remark?: string }) => api.post('/suite/leave/' + leave.id + '/cancel', { remark, version: leave.version }),
    onSettled: () => { cache.invalidateQueries({ queryKey: ['records', 'leave-requests'] }); cache.invalidateQueries({ queryKey: ['leave'] }) } })
}

// Timetable 2.0 and Leave 2.0: the effective day, balances, the approval queue, impact, the office's cover view.
/** One day as the caller lives it; a parent passes the child whose class to show. */
export function useTimetableDay(date: string, studentId?: string, enabled = true) {
  const allowed = usePermission('timetable.view')
  return useQuery({ queryKey: ['timetable', 'today', date, studentId ?? ''], enabled: enabled && allowed, staleTime: 60_000, queryFn: () => get<TimetableDay>('/suite/timetable/today', { date, ...(studentId ? { studentId } : {}) }) })
}
export interface LeaveBalance { typeId: string, name: string, code: string, paid: string, tracksBalance: boolean, active: boolean, allowance: number, added: number, deducted: number, used: number, pending: number, remaining: number | null, afterPending: number | null }
export interface LeaveBalances { teacherId: string, teacherName: string, year: { name: string, from: string, to: string }, balances: LeaveBalance[] }
export function useLeaveBalances(enabled = true) {
  const allowed = usePermission('leave-requests.view'), staff = useSession(state => state.user?.dataScope === 'teacher')
  return useQuery({ queryKey: ['leave', 'balances'], enabled: enabled && allowed && staff, staleTime: 60_000, queryFn: () => get<LeaveBalances>('/suite/leave/balances') })
}
export interface QueueItem extends Leave { teacherName: string, typeName: string, remaining: number | null, tracksBalance: boolean, impact: { affected: number, covered: number, uncovered: number } }
export function useLeaveQueue(enabled = true) {
  const allowed = usePermission('leave-requests.view'), office = useSession(state => state.user?.dataScope === 'school')
  return useQuery({ queryKey: ['leave', 'queue'], enabled: enabled && allowed && office, staleTime: 30_000, queryFn: () => get<{ items: QueueItem[], total: number, canApprove: boolean }>('/suite/leave/queue') })
}
export interface LeaveImpact { leaveId: string, teacherName: string, days: number, summary: { affected: number, covered: number, uncovered: number }, periods: { id: string, date: string, startsAt: string, endsAt: string, className: string, subjectName: string, status: 'covered' | 'uncovered', substitution?: { teacherName: string } }[] }
export function useLeaveImpact(leaveId: string | undefined) {
  const allowed = usePermission('leave-requests.view')
  return useQuery({ queryKey: ['leave', 'impact', leaveId], enabled: allowed && !!leaveId, staleTime: 30_000, queryFn: () => get<LeaveImpact>('/suite/leave/' + leaveId + '/impact') })
}
export function useOperations(date: string, enabled = true) {
  const allowed = usePermission('substitutions.view'), office = useSession(state => state.user?.dataScope === 'school')
  return useQuery({ queryKey: ['timetable', 'operations', date], enabled: enabled && allowed && office, staleTime: 30_000, queryFn: () => get<Operations>('/suite/timetable/operations', { date }) })
}
export function useCandidates(timetableId: string, date: string) {
  const allowed = usePermission('substitutions.manage')
  return useQuery({ queryKey: ['timetable', 'candidates', timetableId, date], enabled: allowed, staleTime: 30_000, queryFn: () => get<{ period: Period, candidates: Candidate[] }>('/suite/timetable/candidates', { timetableId, date }) })
}
/** Assign or change the substitute for one period on one date; the server refuses a teacher who is busy or away. */
export function useAssignSubstitute() {
  const cache = useQueryClient()
  return useMutation({ mutationFn: async ({ date, timetableId, teacherId, existing }: { date: string, timetableId: string, teacherId: string, existing?: Substitution }): Promise<unknown> =>
    existing ? api.put('/suite/records/substitutions/' + existing.id, { date, timetableId, teacherId, note: existing.note, version: existing.version }) : api.post('/suite/records/substitutions', { date, timetableId, teacherId }),
    onSettled: () => { cache.invalidateQueries({ queryKey: ['timetable'] }); cache.invalidateQueries({ queryKey: ['leave'] }) } })
}

// Admissions 2.0: leadership reads the pipeline and an applicant, and decides where its permissions allow.
export function useAdmissionsPipeline(enabled = true) {
  const allowed = usePermission('admissions.view'), office = useSession(state => state.user?.dataScope === 'school')
  return useQuery({ queryKey: ['admissions', 'pipeline'], enabled: enabled && allowed && office, staleTime: 30_000, queryFn: () => get<AdmissionPipeline>('/suite/admissions/pipeline') })
}
export function useAdmission(id: string | undefined) {
  const allowed = usePermission('admissions.view')
  return useQuery({ queryKey: ['admissions', 'detail', id], enabled: allowed && !!id, staleTime: 30_000, queryFn: () => get<AdmissionDetail>('/suite/admissions/' + id) })
}
/** A decision with the record's version, so one already taken by someone else is refused, not repeated. */
export function useAdmissionDecision() {
  const cache = useQueryClient()
  return useMutation({ mutationFn: ({ id, ...body }: { id: string, to: string, reason: string, version: number, acknowledgeDuplicates: boolean }) => api.post('/suite/admissions/' + id + '/transition', body),
    onSettled: () => cache.invalidateQueries({ queryKey: ['admissions'] }) })
}
