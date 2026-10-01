import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Megaphone } from 'lucide-react'
import client from '../../api/client'

// Amounts are whole minor units (paise for INR) and always come from the server.
export type Plan = { id: string, name: string, description: string, status: string, billingPeriod: string, basePrice: number, currency: string, trialDays: number, features: string[], displayOrder: number, highlighted: boolean }
export type Quote = { basePrice: number, discount: number, finalAmount: number, currency: string, offerId: string | null, offerName: string | null }
export type Subscription = { schoolId: string, schoolName: string, schoolActive: boolean, planId: string | null, planName: string | null, status: string | null, effectiveStatus: string, startsAt: string | null, endsAt: string | null, billingPeriod: string | null, basePrice: number, discount: number, finalAmount: number, currency: string, paymentState: string | null, note?: string | null, overrides?: { planId: string, price: number, note: string }[] }
export type Payment = { id: string, schoolId: string, schoolName: string, planName: string, provider: string, providerOrderId: string, providerPaymentId: string | null, baseAmount: number, discount: number, amount: number, currency: string, billingPeriod: string, status: string, failureReason: string | null, receiptNo: number, createdAt: string, verifiedAt: string | null }
type Banner = { id: string, title: string, message: string, ctaLabel: string, ctaUrl: string }

export const money = (minor: number, currency = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(minor / 100)
export const day = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
export const period: Record<string, string> = { monthly: 'month', quarterly: 'quarter', yearly: 'year' }
export const statusLabel = (status: string) => status === 'None' ? 'No subscription' : status
export const paymentLabel = (status: string) => status === 'Created' ? 'Pending' : status
const good = ['Active', 'Trial', 'Complimentary', 'Paid'], warn = ['Grace Period', 'Expired', 'Failed', 'Cancelled']
export function StatusTag({ status }: { status: string }) { return <span className={'status-tag ' + (good.includes(status) ? 'active' : warn.includes(status) ? 'important' : '')}>{statusLabel(status)}</span> }

// Commercial messages are configured by the platform. Nothing is shown when no promotion is running.
export function PromoBanner({ placement }: { placement: 'login' | 'pricing' | 'admin-dashboard' | 'subscription' }) {
  const banners = useQuery<Banner[]>({ queryKey: ['promotions', placement], staleTime: 300000, retry: false, queryFn: async () => (await client.get('/promotions', { params: { placement } })).data.data })
  if (!banners.data?.length) return null
  return <>{banners.data.map(b => <aside key={b.id} className="promo-banner" aria-label="Promotion"><Megaphone size={20} /><div><strong>{b.title}</strong>{b.message && <span>{b.message}</span>}</div>{b.ctaLabel && b.ctaUrl && <Link className="button small primary" to={b.ctaUrl}>{b.ctaLabel}</Link>}</aside>)}</>
}

// Built with DOM text nodes only, so nothing in a record can be interpreted as markup.
export function printReceipt(p: Payment) {
  const w = window.open('', '_blank', 'width=640,height=720'); if (!w) return
  const rows: [string, string][] = [['Receipt no.', 'EDUOS-' + String(p.receiptNo).padStart(6, '0')], ['School', p.schoolName], ['Plan', p.planName + ' (' + p.billingPeriod + ')'], ['Price', money(p.baseAmount, p.currency)], ['Discount', money(p.discount, p.currency)], ['Amount paid', money(p.amount, p.currency)], ['Paid on', day(p.verifiedAt)], ['Payment provider', 'Razorpay'], ['Order ID', p.providerOrderId], ['Payment ID', p.providerPaymentId || '—']]
  const d = w.document; d.title = 'EduOS receipt'; d.body.style.fontFamily = 'sans-serif'; d.body.style.padding = '24px'
  const heading = d.createElement('h2'); heading.textContent = 'EduOS payment receipt'
  const table = d.createElement('table'); table.cellPadding = '8'
  for (const [label, value] of rows) { const row = table.insertRow(); row.insertCell().textContent = label; const cell = row.insertCell(); cell.textContent = value; cell.style.fontWeight = '600' }
  d.body.append(heading, table); w.focus(); w.print()
}
