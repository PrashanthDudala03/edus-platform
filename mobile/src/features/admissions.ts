// Admissions on the phone: the shapes the admissions endpoints return and the pure logic the screen uses, tested with
// node:test. The server decides every transition; this only offers what the account may try.
export interface AdmissionItem { id: string, version: number, applicationNumber: string, status: string, name: string, className: string, yearName: string, guardianName: string, submittedAt: string, documents: { required: number, verified: number }, duplicates: number }
export interface AdmissionPipeline { counts: Record<string, number>, total: number, items: AdmissionItem[] }
export interface AdmissionDetail extends Omit<AdmissionItem, 'duplicates'> { application: Record<string, string>, duplicates: { label: string, reasons: string[] }[], onboarding: { blockers: string[], done: number, total: number } }
export const ADMISSION_GROUPS = [{ key: 'Decide', label: 'To decide' }, { key: 'Onboarding', label: 'Onboarding' }, { key: 'Done', label: 'Closed' }] as const
/** Which list an application sits in on the phone. */
export const admissionGroup = (status: string) => ['Draft', 'Submitted', 'Under Review', 'Waitlisted'].includes(status) ? 'Decide' : ['Approved', 'Onboarding', 'Ready'].includes(status) ? 'Onboarding' : 'Done'
export const admissionTone = (status: string) => status === 'Ready' || status === 'Active' ? 'success' as const : status === 'Rejected' || status === 'Withdrawn' ? 'neutral' as const : status === 'Waitlisted' ? 'warning' as const : 'primary' as const
/** Decisions the phone offers: review, approve, waitlist and reject. Submitting drafts, onboarding and activation stay on the web. */
export function mobileDecisions(status: string, p: { approve: boolean, manage: boolean }) {
  const out: { to: string, label: string, reason: boolean, primary?: boolean }[] = []
  if (status === 'Submitted' && (p.approve || p.manage)) out.push({ to: 'Under Review', label: 'Start review', reason: false, primary: true })
  if ((status === 'Under Review' || status === 'Waitlisted') && p.approve) out.push({ to: 'Approved', label: 'Approve', reason: false, primary: true })
  if (status === 'Under Review' && p.approve) out.push({ to: 'Waitlisted', label: 'Waitlist', reason: true })
  if (['Submitted', 'Under Review', 'Waitlisted'].includes(status) && p.approve) out.push({ to: 'Rejected', label: 'Reject', reason: true })
  return out
}
