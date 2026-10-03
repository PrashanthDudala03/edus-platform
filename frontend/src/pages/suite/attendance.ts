// The register's rules as the web needs them. The server decides everything that matters (who may mark whom,
// whether a change is a correction, reasons); these helpers only shape what the screen shows and sends.
export type Status = 'Present' | 'Absent' | 'Late' | 'Excused'
export const STATUSES: Status[] = ['Present', 'Late', 'Absent', 'Excused']
export const SHORT: Record<Status, string> = { Present: 'P', Late: 'L', Absent: 'A', Excused: 'E' }
export type Mark = { status: Status, reason?: string, remark?: string }
export type RegisterRow = { id: string, code: string, name: string, class: string, status: Status | null, reason?: string | null, remark?: string | null }
export type ClassRegister = { className: string, expected: number, marked: number, present: number, absent: number, late: number, excused: number, state: string, teacher: string | null, submittedAt: string | null, correctedAt: string | null, submittedBy: string | null }
export type DayRecord = { day: string, status: Status, reason: string | null, remark: string | null }

/** A reason can go with Absent, Late or Excused. */
export const mayHaveReason = (status: Status) => status !== 'Present'
/** Counts for what is on screen, taking unsaved choices into account. */
export function summary(rows: RegisterRow[], draft: Record<string, Mark>) {
  const counts = { Present: 0, Late: 0, Absent: 0, Excused: 0, unmarked: 0, total: rows.length }
  for (const row of rows) { const status = draft[row.id]?.status ?? row.status; if (status) counts[status]++; else counts.unmarked++ }
  return counts
}
/** Only what differs from the saved register is sent; a reason is sent only with a status that can carry one. */
export function changes(rows: RegisterRow[], draft: Record<string, Mark>) {
  return rows.flatMap(row => {
    const mark = draft[row.id]; if (!mark) return []
    const reason = mayHaveReason(mark.status) ? (mark.reason ?? row.reason ?? '') : '', remark = mayHaveReason(mark.status) ? (mark.remark ?? row.remark ?? '') : ''
    if (mark.status === row.status && reason === (row.reason ?? '') && remark === (row.remark ?? '')) return []
    return [{ studentId: row.id, status: mark.status, reason, remark }]
  })
}
/** Everyone without a status becomes Present; choices already made are kept. */
export function markRestPresent(rows: RegisterRow[], draft: Record<string, Mark>): Record<string, Mark> {
  const next = { ...draft }
  for (const row of rows) if (!row.status && !next[row.id]) next[row.id] = { status: 'Present' }
  return next
}
export const classesOf = (rows: RegisterRow[]) => [...new Set(rows.map(row => row.class).filter(Boolean))].sort()
/** The classes whose register is already submitted, so the next change to them is a correction and needs a reason. */
export const submittedClasses = (registers: ClassRegister[]) => new Set(registers.filter(r => r.state === 'Submitted' || r.state === 'Corrected').map(r => r.className))
export const isCorrection = (rows: RegisterRow[], draft: Record<string, Mark>, submitted: Set<string>) => changes(rows, draft).some(change => submitted.has(rows.find(row => row.id === change.studentId)?.class ?? ''))
/** How a register state reads, and the tone it is shown in. */
export const stateTone = (state: string) => state === 'Submitted' || state === 'Corrected' ? 'active' : state === 'In progress' || state === 'Marked' ? 'important' : ''
export const percent = (attended: number, marked: number) => marked > 0 ? Math.round(attended / marked * 100) : null
export const filterRows = (rows: RegisterRow[], cls: string, search: string) => rows.filter(row => (!cls || row.class === cls) && (!search || (row.name + ' ' + row.code).toLowerCase().includes(search.toLowerCase())))
