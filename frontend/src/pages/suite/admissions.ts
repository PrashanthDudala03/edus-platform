// Admissions 2.0 presentation helpers, kept free of React so they are unit tested. The server decides every status,
// blocker and figure; these only arrange and word what it returns.
export type Status = 'Draft' | 'Submitted' | 'Under Review' | 'Approved' | 'Waitlisted' | 'Rejected' | 'Withdrawn' | 'Onboarding' | 'Ready' | 'Active'
export type PipelineItem = { id: string, version: number, applicationNumber: string, admissionNumber: string, status: Status, name: string, classId: string, className: string, yearName: string, guardianName: string, submittedAt: string, createdAt: string, studentId: string, documents: { required: number, verified: number, files: number }, duplicates: number }
export type Pipeline = { counts: Record<Status, number>, total: number, page: number, pageSize: number, items: PipelineItem[], canApprove: boolean, canManage: boolean, canOnboard: boolean }
export type Step = { key: string, label: string, done: boolean, required: boolean, detail: string }
export type DocumentCheck = { key: string, label: string, required: boolean, status: string, note: string, checkedAt: string }
export type Checklist = { steps: Step[], blockers: string[], done: number, total: number, documents: DocumentCheck[], attachments: { id: string, name: string, uploadedAt: string }[], guardian: { mode: string, parentId: string, relationship: string, confirmed: boolean }, academics: { classId: string, className: string }, fees: { mode: string, reason: string, structures: { id: string, name: string, installment: string, dueDate: string, amount: number }[], total: number }, accounts: { parentUserId?: string, studentUserId?: string }, detailsConfirmed: boolean }
export type Duplicate = { source: 'application' | 'student', id: string, label: string, number: string, status: string, reasons: string[] }
export type HistoryEntry = { from: string, to: string, by: string, at: string, reason: string }
export type FormQuestion = { key: string, label: string, type: string, options: string, required: boolean }
export type Detail = Omit<PipelineItem, 'documents' | 'duplicates'> & { application: Record<string, string>, answers: Record<string, unknown>, history: HistoryEntry[], duplicates: Duplicate[], onboarding: Checklist, started: boolean, form: FormQuestion[] }
export type Perms = { manage: boolean, approve: boolean, onboard: boolean }

export const TABS: (Status | 'All')[] = ['All', 'Submitted', 'Under Review', 'Approved', 'Waitlisted', 'Onboarding', 'Ready', 'Active', 'Draft', 'Rejected', 'Withdrawn']
export const STEP_ORDER = ['details', 'guardian', 'documents', 'academics', 'fees', 'accounts'] as const
export const RELATIONSHIPS = ['Mother', 'Father', 'Guardian', 'Other'] as const
export const DOCUMENT_STATUSES = ['Required', 'Uploaded', 'Verified', 'Rejected', 'Not applicable'] as const
export const statusTone = (s: string) => s === 'Active' || s === 'Ready' ? 'active' : s === 'Rejected' || s === 'Withdrawn' ? 'muted' : s === 'Waitlisted' || s === 'Under Review' ? 'important' : ''
/** The decisions a person may take from a status; the server checks them again. */
export function decisionsFor(status: string, p: Perms): { to: string, label: string, reason: boolean, primary?: boolean }[] {
  const out: { to: string, label: string, reason: boolean, primary?: boolean }[] = []
  if (status === 'Draft' && p.manage) out.push({ to: 'Submitted', label: 'Submit application', reason: false, primary: true })
  if (status === 'Submitted' && (p.manage || p.approve)) out.push({ to: 'Under Review', label: 'Start review', reason: false, primary: true })
  if ((status === 'Under Review' || status === 'Waitlisted') && p.approve) out.push({ to: 'Approved', label: 'Approve', reason: false, primary: true })
  if (status === 'Under Review' && p.approve) out.push({ to: 'Waitlisted', label: 'Waitlist', reason: true })
  if (status === 'Waitlisted' && p.approve) out.push({ to: 'Under Review', label: 'Back to review', reason: false })
  if (['Submitted', 'Under Review', 'Waitlisted'].includes(status) && p.approve) out.push({ to: 'Rejected', label: 'Reject', reason: true })
  if (['Draft', 'Submitted', 'Under Review', 'Waitlisted', 'Approved', 'Onboarding', 'Ready'].includes(status) && p.manage) out.push({ to: 'Withdrawn', label: 'Withdraw', reason: true })
  return out
}
export const editable = (status: string) => !['Active', 'Rejected', 'Withdrawn'].includes(status)
export const docProgress = (d: { required: number, verified: number }) => d.required === 0 ? 'No documents required' : d.verified + ' of ' + d.required + ' verified'
/** The first required step not yet done: where the office should go next. */
export const nextStep = (steps: Step[]) => STEP_ORDER.find(k => steps.find(s => s.key === k && s.required && !s.done)) ?? (steps.some(s => s.key === 'accounts' && !s.done) ? 'accounts' : 'review')
export const percent = (c: Pick<Checklist, 'done' | 'total'>) => c.total ? Math.round(c.done * 100 / c.total) : 0
/** A strong temporary password the person never sees: they set their own with the one-time recovery code. */
export function hiddenPassword(random: (n: number) => Uint8Array = n => crypto.getRandomValues(new Uint8Array(n))) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%*+'
  return Array.from(random(32), b => chars[b % chars.length]).join('')
}
/** An answer as the form posts it: multiple choice as a list, a checkbox as true/false, the rest as text. */
export function answerValue(q: FormQuestion, form: FormData): unknown {
  if (q.type === 'Multiple choice') return form.getAll('answer:' + q.key).map(String)
  if (q.type === 'Checkbox') return form.get('answer:' + q.key) === 'on'
  const v = form.get('answer:' + q.key); return v == null ? '' : String(v).trim()
}
export const choices = (q: FormQuestion) => q.options.split(',').map(x => x.trim()).filter(Boolean)
export const shortDate = (iso: string) => iso ? iso.slice(0, 10) : '—'
