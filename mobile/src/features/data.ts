import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { can } from '@/access/experience'
import { api, useSession } from '@/services'
import { isoMonth } from '@/utils/format'
import type { AttendanceStatus, CalendarEvent, Charge, Child, Circular, ClassRegister, DayRecord, Exam, Homework, Leave, Message, RegisterRow, RegisterTotals, ReportCard, Submission } from './logic'

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
export const useLeave = (enabled = true) => useRecords<Leave>('leave-requests', r => ({ id: s(r.id), version: n(r.version), teacherId: s(r.teacherId), fromDate: s(r.fromDate).slice(0, 10), toDate: s(r.toDate).slice(0, 10), reason: s(r.reason), status: s(r.status), approvalRemark: s(r.approvalRemark) }), enabled)

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
    const card = await get<Row>('/suite/report-cards/' + studentId)
    return { obtained: n(card.obtained), maximum: n(card.maximum), percent: n(card.percent), grade: s(card.grade),
      results: (Array.isArray(card.results) ? card.results as Row[] : []).map(r => ({ exam: s(r.exam), subject: s(r.subject), score: n(r.score), maximum: n(r.maximum), pass: r.pass === true, remarks: s(r.remarks) })) }
  } })
}
export function useFees(enabled = true) {
  const allowed = usePermission('fees.view')
  return useQuery({ queryKey: ['fees'], enabled: enabled && allowed, staleTime: 60_000, queryFn: async (): Promise<Charge[]> => (await get<Row[]>('/suite/fees')).map(r => ({ id: s(r.id), studentId: s(r.studentId), student: s(r.student), description: s(r.description),
    dueDate: s(r.dueDate).slice(0, 10), gross: n(r.gross), concession: n(r.concession), paid: n(r.paid), balance: n(r.balance), currency: s(r.currency) })) })
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
export function useSubmitHomework() {
  const cache = useQueryClient()
  return useMutation({ mutationFn: (input: { homeworkId: string, studentId: string, response: string }) => api.post('/suite/records/submissions', { ...input, feedback: '', grade: '' }), onSuccess: () => cache.invalidateQueries({ queryKey: ['records', 'submissions'] }) })
}
export function useRequestLeave() {
  const cache = useQueryClient()
  return useMutation({ mutationFn: (input: { teacherId: string, fromDate: string, toDate: string, reason: string }) => api.post('/suite/records/leave-requests', { ...input, status: 'Pending', approvalRemark: '' }), onSuccess: () => cache.invalidateQueries({ queryKey: ['records', 'leave-requests'] }) })
}
/** Approve or reject. The record's version is sent, so a request someone else already decided is refused, not overwritten. */
export function useDecideLeave() {
  const cache = useQueryClient()
  return useMutation({ mutationFn: ({ leave, status, remark }: { leave: Leave, status: 'Approved' | 'Rejected', remark: string }) =>
    api.put('/suite/records/leave-requests/' + leave.id, { teacherId: leave.teacherId, fromDate: leave.fromDate, toDate: leave.toDate, reason: leave.reason, status, approvalRemark: remark, version: leave.version }),
    onSettled: () => cache.invalidateQueries({ queryKey: ['records', 'leave-requests'] }) })
}
