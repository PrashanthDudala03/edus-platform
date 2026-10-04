// Student 360 as the web shows it. The server composes the picture from the modules that own the data and decides
// what the role may see; these helpers only shape the page and are unit tested.
export type Visibility = { contact: boolean, fees: boolean, guardians: boolean, history: boolean }
export type Guardian = { name: string, relationship: string, email: string }
export type Header = { id: string, name: string, firstName: string, lastName: string, admissionNumber: string, className: string, year: string, status: string, admissionDate: string | null, email: string, phone: string, dateOfBirth: string | null, guardians: Guardian[] }
export type Summary = { present: number, late: number, absent: number, excused: number, markedDays: number, percent: number | null }
export type Attendance = { month: string, thisMonth: Summary, year: Summary, from: string, to: string, recent: { day: string, status: string, reason: string, remark: string }[] }
export type HomeworkDue = { id: string, title: string, subject: string, dueDate: string, dueTime: string, group: string }
export type Homework = { assigned: number, counts: Record<string, number>, completion: number | null, due: HomeworkDue[], feedback: { title: string, subject: string, grade: string, feedback: string, reviewedAt: string }[] }
export type UpcomingExam = { id: string, name: string, subjectName: string, date: string, startsAt: string, endsAt: string, room: string, status: string }
export type LatestResult = { exam: string, term: string, subject: string, status: string, score: number | null, maximum: number | null, grade: string, pass: boolean, components: { name: string, max: number, score: number | null }[] }
export type Exams = { upcoming: UpcomingExam[], published: number, obtained: number, maximum: number, percent: number, grade: string, passed: number, failed: number, latest: LatestResult[] }
export type Fees = { available: true, charges: number, applicable: number, paid: number, outstanding: number, overdue: number, currency: string, recentPayments: { id: string, receipt: string, amount: number, method: string, paidOn: string, description: string, currency: string }[] } | { available: false, reason: string }
export type Document = { id: string, type: string, number: string, issuedOn: string, files: number }
export type Notice = { id: string, title: string, audience: string, createdAt: string, dueDate: string }
export type Event = { at: string, kind: string, title: string, detail: string, source: string, entityId: string }
export type Timeline = { items: Event[], total: number, more: boolean, page: number, pageSize: number }
export type Academics = { year: string, yearStatus: string, classId: string, className: string, section: string, classTeacher: string, allocated: boolean, subjects: { subject: string, teacher: string }[] }
export type TodayPeriod = { id: string, startsAt: string, endsAt: string, subjectName: string, teacherName: string, effectiveTeacherName?: string, room: string, substituted?: boolean }
export type Today = { date: string, day: string, className: string, periods: TodayPeriod[] }
export type Student360 = { student: Header, visibility: Visibility, academics: Academics, attendance: Attendance, homework: Homework, exams: Exams, fees: Fees, documents: Document[], notices: Notice[], timetable?: Today, timeline: Timeline, generatedAt: string }

export type Tab = 'overview' | 'academics' | 'attendance' | 'homework' | 'exams' | 'fees' | 'documents' | 'timeline'
export const TAB_LABEL: Record<Tab, string> = { overview: 'Overview', academics: 'Academics', attendance: 'Attendance', homework: 'Homework', exams: 'Exams & results', fees: 'Fees', documents: 'Documents', timeline: 'Timeline' }
/** The tabs a viewer gets: fees only where the role may see them. */
export const tabsFor = (see: Pick<Visibility, 'fees'>): Tab[] => (['overview', 'academics', 'attendance', 'homework', 'exams', ...(see.fees ? ['fees' as const] : []), 'documents', 'timeline'] as Tab[])
export const isTab = (value: string | null | undefined, see: Pick<Visibility, 'fees'>): value is Tab => !!value && (tabsFor(see) as string[]).includes(value)
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '?'
/** "—" where nothing has been recorded, never a fake zero. */
export const pct = (value: number | null | undefined) => value == null ? '—' : value + '%'
export const money = (currency: string, value: number) => (currency ? currency + ' ' : '') + value.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
export const attendanceNote = (s: Summary) => s.markedDays === 0 ? 'No days marked yet' : `${s.present + s.late} of ${s.markedDays} days attended`
export const homeworkNote = (h: Homework) => h.assigned === 0 ? 'No homework set yet' : `${h.counts.missing ?? 0} missing · ${(h.counts['due-today'] ?? 0) + (h.counts.upcoming ?? 0)} due`
export const examsNote = (e: Exams) => e.published === 0 ? 'No published results yet' : `${e.passed} passed · ${e.failed} below pass marks`
export const feesNote = (f: Fees) => !f.available ? f.reason : f.charges === 0 ? 'No fees charged yet' : f.outstanding > 0 ? `${f.overdue} overdue of ${f.charges} charges` : 'All charges settled'
export const dayLabel = (date: string) => date ? new Date(date.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : ''
export const whenLabel = (iso: string) => iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
/** Timeline entries grouped by calendar day, newest first (the server already orders them). */
export const byDay = (events: Event[]) => { const groups: { day: string, events: Event[] }[] = []; for (const e of events) { const day = e.at.slice(0, 10); const last = groups[groups.length - 1]; if (last && last.day === day) last.events.push(e); else groups.push({ day, events: [e] }) } return groups }
export const kindTone = (kind: string) => kind === 'attendance' ? 'teal' : kind === 'homework' ? 'blue' : kind === 'exam' || kind === 'result' ? 'peach' : kind === 'fee' || kind === 'payment' ? 'purple' : 'teal'
export const statusTone = (status: string) => status === 'Present' ? 'active' : status === 'Absent' ? 'important' : status === 'Late' ? 'important' : ''
/** Pages the student is still linked to the dashboard's tiles of; used for the overview's quick links. */
export const resultLabel = (r: LatestResult) => r.status === 'Absent' ? 'Absent' : r.status === 'Exempt' ? 'Exempt' : r.maximum == null ? r.grade || '—' : `${r.score} / ${r.maximum}${r.grade ? ' · ' + r.grade : ''}`
