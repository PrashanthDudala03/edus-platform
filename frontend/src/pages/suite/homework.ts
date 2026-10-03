// Homework & assignments as the web shows them. The server decides lifecycle, lateness and who sees what; these
// helpers only shape the board and the forms. Pure, so they are unit tested.
export type Group = 'due-today' | 'upcoming' | 'submitted' | 'reviewed' | 'late' | 'missing' | 'excused' | 'closed'
/** How work comes back: information only, a tap to confirm, a written answer, files, or shown in class. */
export type Mode = 'None' | 'Done' | 'Text' | 'File' | 'Physical'
export type Outcome = '' | 'Completed' | 'Late' | 'Missing' | 'Excused'
export type Submission = { id: string, version: number, status: 'Submitted' | 'Reviewed' | '', submittedAt: string, late: boolean, outcome: Outcome, verifiedAt: string, response: string, grade: string, feedback: string, reviewedAt: string, resubmissions: number, attachments?: number }
export type Assignment = { id: string, version?: number, title: string, classId: string, className: string, subjectId: string, subjectName: string, teacher: string, instructions: string, dueDate: string, dueTime: string, maxMarks: string, submissionMode: Mode, status: 'Draft' | 'Published' | 'Closed', publishedOn: string, attachments: number }
export type BoardItem = Assignment & { group: Group, submission: Submission | null }
export type OverviewItem = Assignment & { assigned: number, submitted: number, late: number, reviewed: number, pending: number, missing: number, excused?: number, overdue: boolean }
export type ReviewRow = { studentId: string, name: string, code: string, group: Group, submission: Submission | null }

export const GROUP_LABEL: Record<Group, string> = { 'due-today': 'Due today', upcoming: 'Upcoming', submitted: 'Completed', reviewed: 'Reviewed', late: 'Completed late', missing: 'Missing', excused: 'Excused', closed: 'Closed' }
export const GROUPS: Group[] = ['due-today', 'upcoming', 'missing', 'late', 'submitted', 'reviewed', 'excused', 'closed']
export const MODES: Mode[] = ['Done', 'Text', 'File', 'Physical', 'None']
export const MODE_LABEL: Record<Mode, string> = { None: 'No online submission', Done: 'Mark as done', Text: 'Text response', File: 'Online file submission', Physical: 'Physical / in-class submission' }
export const MODE_HELP: Record<Mode, string> = { None: 'Information only. Nothing is tracked per student.', Done: 'Students tap "Mark as done" when the work is finished. No upload.', Text: 'Students write their answer in the app. No upload.', File: 'Students upload photos or files of their work.', Physical: 'Work is shown in class; you check it off as completed, late, missing or excused.' }
export const OUTCOMES: Exclude<Outcome, ''>[] = ['Completed', 'Late', 'Missing', 'Excused']
/** The student acts online in these modes; files are asked for only in File mode. */
export const studentSubmits = (mode: Mode) => mode === 'Done' || mode === 'Text' || mode === 'File'
export const tracked = (mode: Mode) => mode !== 'None'
/** The tone a group is shown in: attention for anything overdue or missing, success once done or reviewed. */
export const groupTone = (group: Group) => group === 'missing' || group === 'late' ? 'important' : group === 'reviewed' || group === 'submitted' ? 'active' : ''
/** Groups that still need something from the student, soonest first. */
export const needsAttention = (items: BoardItem[]) => items.filter(i => i.group === 'due-today' || i.group === 'upcoming' || i.group === 'missing').sort((a, b) => (a.dueDate + a.dueTime).localeCompare(b.dueDate + b.dueTime))
export const dueLabel = (item: Pick<Assignment, 'dueDate' | 'dueTime'>) => item.dueDate ? new Date(item.dueDate + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) + (item.dueTime ? ' ' + item.dueTime : '') : ''
export const marksLabel = (submission: Submission | null, maxMarks: string) => submission?.grade ? submission.grade + (maxMarks ? ' / ' + maxMarks : '') : ''
/** What a teacher still has to do across their assignments. */
export const overviewTotals = (items: OverviewItem[]) => ({ toReview: items.reduce((n, i) => n + i.pending, 0), missing: items.reduce((n, i) => n + i.missing, 0), late: items.reduce((n, i) => n + i.late, 0), published: items.filter(i => i.status === 'Published').length, drafts: items.filter(i => i.status === 'Draft').length })
/** The next status an assignment can move to from the editor. */
export const nextStatuses = (status: Assignment['status'] | '', submissions: number): Assignment['status'][] => status === 'Draft' || status === '' ? ['Draft', 'Published'] : status === 'Published' ? (submissions > 0 ? ['Published', 'Closed'] : ['Draft', 'Published', 'Closed']) : ['Closed', 'Published']
export type Draft = { title: string, classId: string, subjectId: string, dueDate: string, dueTime: string, maxMarks: string, submissionMode: Mode, status: Assignment['status'], instructions: string }
export const emptyDraft = (today: string): Draft => ({ title: '', classId: '', subjectId: '', dueDate: today, dueTime: '', maxMarks: '', submissionMode: 'Done', status: 'Draft', instructions: '' })
export const toDraft = (a: Assignment): Draft => ({ title: a.title, classId: a.classId, subjectId: a.subjectId, dueDate: a.dueDate, dueTime: a.dueTime, maxMarks: a.maxMarks, submissionMode: a.submissionMode, status: a.status, instructions: a.instructions })
/** What the student does with this assignment, in their words. */
export const handInLabel = (item: BoardItem) => item.submissionMode === 'Done' ? (item.submission ? 'Marked as done' : 'Mark as done') : item.submission ? 'Hand in again' : 'Hand in'
