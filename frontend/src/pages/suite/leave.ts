// Leave & Approvals 2.0 presentation helpers, kept free of React so they are unit tested. Figures come from the
// server (days, balances, impact); these only word and arrange them.
export type Balance = { typeId: string, name: string, code: string, paid: string, tracksBalance: boolean, active: boolean, year: string, allowance: number, added: number, deducted: number, used: number, pending: number, remaining: number | null, afterPending: number | null }
export type Balances = { teacherId: string, teacherName: string, year: { name: string, from: string, to: string }, balances: Balance[], adjustments: Adjustment[] }
export type Adjustment = { id: string, typeId: string, direction: 'Add' | 'Deduct', days: number, effectiveOn: string, reason: string, createdAt: string }
export type Leave = { id: string, version: number, teacherId: string, typeId: string, fromDate: string, toDate: string, halfDay: string, reason: string, status: string, approvalRemark: string, days?: number, submittedAt?: string, decidedAt?: string, createdAt?: string }
export type QueueItem = Leave & { teacherName: string, typeName: string, remaining: number | null, tracksBalance: boolean, impact: { affected: number, covered: number, uncovered: number } }
export type Impact = { leaveId: string, teacherId: string, teacherName: string, fromDate: string, toDate: string, halfDay: string, days: number, dates: string[], periods: ImpactPeriod[], summary: { affected: number, covered: number, uncovered: number } }
export type ImpactPeriod = { id: string, date: string, day: string, startsAt: string, endsAt: string, className: string, subjectName: string, room: string, status: 'covered' | 'uncovered', substitution?: { id: string, teacherName: string } }

export const STATUSES = ['Pending', 'Approved', 'Rejected', 'Cancelled'] as const
export const HALF_DAYS = ['No', 'First half', 'Second half'] as const
/** Calendar days inclusive; a half day is half of one. Mirrors the server, which is the figure of record. */
export const leaveDays = (from: string, to: string, halfDay = 'No') => {
  if (!from || !to) return 0
  if (halfDay === 'First half' || halfDay === 'Second half') return 0.5
  const days = Math.round((new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / 86400000) + 1
  return days > 0 ? days : 0
}
export const fmtDays = (n: number | null | undefined) => n == null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1)
export const range = (from: string, to: string, halfDay = 'No') => from === to ? from + (halfDay && halfDay !== 'No' ? ' · ' + halfDay.toLowerCase() : '') : from + ' to ' + to
export const statusTone = (status: string) => status === 'Approved' ? 'active' : status === 'Rejected' ? 'important' : status === 'Cancelled' ? 'muted' : ''
/** Who may withdraw or cancel: the staff member while pending, leadership while pending or approved. */
export const canCancel = (status: string, mine: boolean, approver: boolean) => status === 'Pending' ? mine || approver : status === 'Approved' && approver
export const balanceNote = (b: Balance) => b.tracksBalance ? fmtDays(b.remaining) + ' of ' + fmtDays(b.allowance + b.added - b.deducted) + ' days left' + (b.pending ? ' · ' + fmtDays(b.pending) + ' pending' : '') : 'Not tracked'
/** The leave type to offer when a request is new: active ones; the first with a balance left is the default. */
export const defaultType = (balances: Balance[]) => (balances.find(b => b.active && (!b.tracksBalance || (b.afterPending ?? 0) > 0)) ?? balances.find(b => b.active))?.typeId ?? ''
export const impactWord = (s: { affected: number, covered: number, uncovered: number }) => s.affected === 0 ? 'No lessons affected' : s.uncovered === 0 ? s.affected + ' lesson' + (s.affected === 1 ? '' : 's') + ', all covered' : s.uncovered + ' of ' + s.affected + ' lesson' + (s.affected === 1 ? '' : 's') + ' still need cover'
export const byMonth = (rows: Leave[]) => { const m: Record<string, Leave[]> = {}; for (const r of rows) (m[r.fromDate.slice(0, 7)] ??= []).push(r); return Object.entries(m).sort(([a], [b]) => b.localeCompare(a)) }
