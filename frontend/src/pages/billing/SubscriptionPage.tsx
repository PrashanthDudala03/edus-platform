import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CreditCard, Info, Printer } from 'lucide-react'
import client, { errorMessage } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { Dialog, Empty, ErrorBox, Loading, PageHeader } from '../../components/UI'
import { day, money, paymentLabel, period, printReceipt, PromoBanner, StatusTag, type Payment, type Quote, type Subscription } from './shared'

type Offered = { id: string, name: string, description: string, billingPeriod: string, currency: string, trialDays: number, features: string[], highlighted: boolean, listPrice: number, quote: Quote }
type Current = { subscription: Subscription, plans: Offered[], graceDays: number, paymentsEnabled: boolean, canPurchase: boolean, payments: Payment[] }
type Checkout = { new(options: Record<string, unknown>): { open(): void, on(event: string, handler: (response: { error?: { description?: string } }) => void): void } }
const notices: Record<string, string> = {
  None: 'Your school has no subscription yet. Everything keeps working; choose a plan below or ask the EduOS team about a trial.',
  'Grace Period': 'Your subscription period has ended. Your school keeps working during the grace period; please renew to avoid interruption.',
  Expired: 'Your subscription has expired. Your school data is safe. Renew below or contact the EduOS team.',
  Cancelled: 'This subscription was cancelled. Your school data is safe. Choose a plan below or contact the EduOS team.',
}
function loadCheckout() {
  return new Promise<Checkout>((resolve, reject) => {
    const ready = () => (window as unknown as { Razorpay?: Checkout }).Razorpay
    if (ready()) return resolve(ready()!)
    const script = document.createElement('script'); script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.onload = () => ready() ? resolve(ready()!) : reject(new Error('The payment window could not be loaded.'))
    script.onerror = () => reject(new Error('The payment window could not be loaded. Check your connection and try again.'))
    document.head.appendChild(script)
  })
}

// The school's own view. Prices and discounts shown here are calculated by the server; this page never sends an amount.
export default function SubscriptionPage() {
  const user = useAuthStore(s => s.user), cache = useQueryClient()
  const current = useQuery<Current>({ queryKey: ['subscription'], queryFn: async () => (await client.get('/subscription/current')).data.data })
  const [choice, setChoice] = useState<Offered | null>(null), [coupon, setCoupon] = useState(''), [quote, setQuote] = useState<Quote | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const refresh = () => cache.invalidateQueries({ queryKey: ['subscription'] })
  function choose(plan: Offered) { setError(''); setMessage(''); setCoupon(''); setQuote(plan.quote); setChoice(plan) }
  async function applyCoupon() {
    setBusy(true); setError('')
    try { setQuote((await client.post('/subscription/quote', { planId: choice!.id, coupon: coupon.trim() || null })).data.data) }
    catch (e) { setError(errorMessage(e)); setQuote(choice!.quote) } finally { setBusy(false) }
  }
  async function pay() {
    const plan = choice!; setBusy(true); setError('')
    try {
      const order = (await client.post('/subscription/checkout', { planId: plan.id, coupon: coupon.trim() || null })).data.data
      if (order.activated) { setChoice(null); setMessage('Your subscription is active.'); await refresh(); return }
      const Razorpay = await loadCheckout()
      // The payment window is drawn on the page, so the plan dialog has to close first.
      setChoice(null)
      await new Promise<void>((resolve, reject) => {
        const checkout = new Razorpay({
          key: order.keyId, order_id: order.orderId, amount: order.amount, currency: order.currency, name: 'EduOS', description: order.plan + ' subscription', prefill: { email: user?.email },
          handler: async (r: { razorpay_order_id: string, razorpay_payment_id: string, razorpay_signature: string }) => {
            try { await client.post('/subscription/verify', { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }); resolve() } catch (e) { reject(e) }
          },
          modal: { ondismiss: () => { client.post('/subscription/payments/' + order.paymentId + '/cancel').catch(() => undefined); reject(new Error('Payment was not completed. You can try again at any time.')) } },
        })
        checkout.on('payment.failed', r => setError(r.error?.description || 'The payment failed. You can try again.'))
        checkout.open()
      })
      setMessage('Payment verified. Your subscription is active.')
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false); await refresh() }
  }
  if (current.isPending) return <Loading />
  if (current.isError) return <ErrorBox message={errorMessage(current.error)} />
  const { subscription: s, plans, payments, paymentsEnabled, canPurchase, graceDays } = current.data
  const running = ['Active', 'Trial', 'Complimentary'].includes(s.effectiveStatus)
  return <><PageHeader eyebrow="SCHOOL ADMINISTRATION" title="Subscription & billing" description="Your school's EduOS plan, renewal date and payment history." />
    <PromoBanner placement="subscription" />
    {error && !choice && <ErrorBox message={error} />} {message && <div className="success-box" role="status">{message}</div>}
    {notices[s.effectiveStatus] && <div className="info-box" role="status"><Info size={18} /><span>{notices[s.effectiveStatus]}{s.effectiveStatus === 'Grace Period' && graceDays ? ' The grace period is ' + graceDays + ' days from ' + day(s.endsAt) + '.' : ''}</span></div>}
    <section className="panel" style={{ padding: 24, marginBottom: 20 }}><h2>Current subscription</h2>
      <dl className="record-details"><div><dt>Current plan</dt><dd>{s.planName || '—'}</dd></div><div><dt>Subscription status</dt><dd><StatusTag status={s.effectiveStatus} /></dd></div><div><dt>Start date</dt><dd>{day(s.startsAt)}</dd></div><div><dt>{s.effectiveStatus === 'Active' ? 'Renewal date' : 'Expiry date'}</dt><dd>{s.status && !s.endsAt ? 'No end date' : day(s.endsAt)}</dd></div>
        <div><dt>Base price</dt><dd>{s.status ? money(s.basePrice, s.currency) : '—'}</dd></div><div><dt>Discount</dt><dd>{s.status ? money(s.discount, s.currency) : '—'}</dd></div><div><dt>Final price</dt><dd>{s.status ? money(s.finalAmount, s.currency) : '—'}</dd></div><div><dt>Payment status</dt><dd>{s.paymentState === 'Paid' ? 'Paid' : s.status ? 'No payment required' : '—'}</dd></div></dl></section>
    <section className="panel" style={{ padding: 24, marginBottom: 20 }}><h2>Plans</h2><PromoBanner placement="pricing" />
      {!plans.length ? <Empty title="No plans are published yet" description="Contact the EduOS team to arrange access for your school." /> : <div className="plan-grid">{plans.map(p => <article key={p.id} className={'plan-card' + (p.highlighted ? ' highlighted' : '')}>
        {p.highlighted && <span className="status-tag active">Recommended</span>}<h3>{p.name}</h3><p className="muted">{p.description}</p>
        <p className="plan-price">{p.quote.finalAmount < p.listPrice && <s>{money(p.listPrice, p.currency)}</s>}<strong>{money(p.quote.finalAmount, p.currency)}</strong><span>per {period[p.billingPeriod]}</span></p>
        {p.quote.offerName && <p className="status-tag important">{p.quote.offerName}</p>}
        <ul>{p.features.map(f => <li key={f}><Check size={14} />{f}</li>)}</ul>
        {canPurchase && <button className={'button ' + (p.highlighted ? 'primary' : 'secondary')} disabled={busy} onClick={() => choose(p)}><CreditCard size={16} />{s.planId === p.id && running ? 'Renew' : s.planId && running ? 'Switch to this plan' : 'Choose plan'}</button>}
      </article>)}</div>}</section>
    <section className="panel" style={{ padding: 24 }}><h2>Payment history</h2>
      {!payments.length ? <p className="muted">No payments yet.</p> : <div className="table-scroll"><table><thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Status</th><th>Reference</th><th className="align-right">Receipt</th></tr></thead><tbody>{payments.map(p => <tr key={p.id}>
        <td>{day(p.createdAt)}</td><td>{p.planName}</td><td>{money(p.amount, p.currency)}</td><td><StatusTag status={paymentLabel(p.status)} />{p.failureReason && <small className="cell-small">{p.failureReason}</small>}</td><td>{p.providerPaymentId || p.providerOrderId}</td>
        <td className="align-right">{p.status === 'Paid' ? <button className="button small secondary" onClick={() => printReceipt(p)}><Printer size={14} />Receipt</button> : '—'}</td></tr>)}</tbody></table></div>}</section>
    {choice && quote && <Dialog title={choice.name + ' plan'} onClose={() => !busy && setChoice(null)}>{error && <ErrorBox message={error} />}
      <dl className="record-details"><div><dt>Price</dt><dd>{money(quote.basePrice, quote.currency)} per {period[choice.billingPeriod]}</dd></div><div><dt>Discount{quote.offerName ? ' · ' + quote.offerName : ''}</dt><dd>{money(quote.discount, quote.currency)}</dd></div><div><dt>Amount to pay</dt><dd><strong>{money(quote.finalAmount, quote.currency)}</strong></dd></div></dl>
      <div className="toolbar-actions"><label>Coupon code<span className="optional"> (optional)</span><input value={coupon} maxLength={40} onChange={e => setCoupon(e.target.value)} autoComplete="off" /></label><button type="button" className="button secondary" disabled={busy || !coupon.trim()} onClick={applyCoupon}>Apply coupon</button></div>
      {quote.finalAmount > 0 && !paymentsEnabled && <div className="info-box" role="status"><Info size={18} /><span>Online payment is not available yet. Contact the EduOS team to activate this plan.</span></div>}
      <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={() => setChoice(null)}>Cancel</button><button className="button primary" disabled={busy || (quote.finalAmount > 0 && !paymentsEnabled)} onClick={pay}>{busy ? 'Please wait…' : quote.finalAmount > 0 ? 'Pay now' : 'Activate'}</button></div></Dialog>}</>
}
