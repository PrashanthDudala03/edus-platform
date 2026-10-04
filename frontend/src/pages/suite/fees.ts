// Fees & collections as the web shows them. The server owns every figure (net, paid, outstanding, state) and every
// rule; these helpers only shape the screens and are unit tested.
export type ChargeState = 'Unpaid' | 'Partial' | 'Paid' | 'Overdue' | 'Waived' | 'Cancelled'
export type Charge = { id: string, studentId: string, student: string, class: string, description: string, structureId: string, dueDate: string, gross: number, concession: number, issueConcession: number, laterConcession: number, fine: number, net: number, paid: number, balance: number, outstanding: number, status: 'Active' | 'Waived' | 'Cancelled', state: ChargeState, overdue: boolean, currency: string, note: string }
export type Totals = { charges: number, applicable: number, concessions: number, fines: number, net: number, paid: number, outstanding: number, overdue: number, overdueCount: number, waived: number, currency: string }
export type Payment = { id: string, receipt: string, amount: number, method: string, reference: string, status: 'Completed' | 'Reversed', source: 'manual' | 'online', note: string, paidOn: string, createdAt: string, reversalReason: string | null, reversedAt: string | null, description: string, currency: string, student?: string, class?: string, studentId?: string, collectedBy?: string }
export type Concession = { id: string, chargeId: string | null, kind: 'Percent' | 'Fixed', value: number, reason: string, from: string | null, to: string | null, status: 'Active' | 'Revoked', createdAt: string, student?: string, studentId?: string }
export type Ledger = { student: { id: string, name: string, admissionNumber: string, class: string }, totals: Totals, charges: Charge[], payments: { items: Payment[], total: number, page: number, pageSize: number, more: boolean }, concessions: Concession[], online: { enabled: boolean, provider: string } }
export type PaymentConfig = { provider: string, merchantReference: string, connectionStatus: string, onlineEnabled: boolean, settlementStatus: string, providers: string[], note: string }
export type Summary = { collectedToday: number, collectedThisMonth: number, reversalsThisMonth: number, totals: Totals, byClass: { class: string, outstanding: number, overdue: number, paid: number }[], recent: Payment[], online: PaymentConfig }
export type Intent = { id: string, status: 'Pending' | 'Verified' | 'Failed' | 'Expired', provider: string, orderReference: string, amount: number, currency: string, instructions?: string }

export const METHODS = ['Cash', 'UPI', 'Bank transfer', 'Cheque', 'Other'] as const
export const STATE_LABEL: Record<ChargeState, string> = { Unpaid: 'Unpaid', Partial: 'Part paid', Paid: 'Paid', Overdue: 'Overdue', Waived: 'Waived', Cancelled: 'Cancelled' }
export const stateTone = (state: ChargeState) => state === 'Paid' ? 'active' : state === 'Overdue' ? 'important' : ''
export const money = (currency: string, value: number | null | undefined) => value == null ? '—' : (currency ? currency + ' ' : '') + Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** A reference is needed for anything that leaves a trail elsewhere; cash and "other" may do without. */
export const needsReference = (method: string) => method === 'UPI' || method === 'Bank transfer' || method === 'Cheque'
/** What the server would refuse, said before the payment is sent. */
export const paymentProblem = (amount: string, outstanding: number, method: string, reference: string) => {
  const n = Number(amount)
  if (!amount.trim() || !Number.isFinite(n) || n <= 0) return 'Enter the amount received.'
  if (Math.round(n * 100) > Math.round(outstanding * 100)) return 'Payment exceeds the outstanding balance.'
  if (!(METHODS as readonly string[]).includes(method)) return 'Choose a payment method.'
  if (needsReference(method) && !reference.trim()) return 'A bank / UPI / cheque reference is required.'
  return null
}
/** Charges that still take a payment, soonest due first; overdue ones come first so they are settled first. */
export const payable = (charges: Charge[]) => charges.filter(c => c.status === 'Active' && c.outstanding > 0).sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.dueDate.localeCompare(b.dueDate))
export const upcoming = (charges: Charge[]) => charges.filter(c => c.status === 'Active' && c.outstanding > 0 && !c.overdue).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
export const concessionLabel = (c: Concession) => (c.kind === 'Percent' ? c.value + '%' : 'Fixed ' + c.value.toLocaleString('en-IN')) + (c.chargeId ? ' on one charge' : ' on every charge') + (c.from || c.to ? ` (${c.from ?? '…'} to ${c.to ?? '…'})` : '')
export const feesNote = (t: Totals) => t.charges === 0 ? 'No fees charged yet' : t.outstanding > 0 ? `${t.overdueCount} overdue of ${t.charges} charges` : 'All charges settled'
/** "Cash 4,000 · UPI 2,500" for the daily report. */
export const methodBreakdown = (byMethod: Record<string, number>, currency: string) => Object.entries(byMethod).map(([m, v]) => `${m} ${money(currency, v)}`).join(' · ')
export const dayLabel = (date: string) => date ? new Date(date.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
