import { ReactNode, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, CalendarCheck, ClipboardList, Megaphone, Wallet, Check, type LucideIcon } from 'lucide-react'
import client, { errorMessage } from '../../api/client'
import { Empty, ErrorBox, Loading, today } from '../../components/UI'
import { data, label, type Options, type Row } from '../suite/helpers'

// Dashboard building blocks. Every figure is read from an existing endpoint, which already limits
// the rows to what the signed-in role may see; nothing here is computed from invented data.
export type Page = { data: Row[], totalCount: number }
export const weekday = () => new Date().toLocaleDateString('en-US', { weekday: 'long' })
export const useOptions = () => useQuery<Options>({ queryKey: ['suite', 'options'], queryFn: () => data('/options') })
export const useRecords = (kind: string, search = '') => useQuery<Page>({ queryKey: ['suite', kind, 'dashboard', search], queryFn: () => data('/records/' + kind, search ? { search } : undefined) })
export const money = (currency: string | undefined, value: number) => (currency || '') + ' ' + value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function StatTile({ label: title, value, note, icon: Icon, tone, to }: { label: string, value: ReactNode, note: string, icon: LucideIcon, tone: string, to?: string }) {
  const body = <><div className="stat-top"><span className={'stat-icon ' + tone}><Icon size={20} /></span>{to && <ArrowUpRight size={17} />}</div><strong>{value}</strong><h3>{title}</h3><p>{note}</p></>
  return to ? <Link className="stat-card" to={to}>{body}</Link> : <div className="stat-card">{body}</div>
}

export function Panel({ title, description, link, linkLabel = 'View all', children }: { title: string, description?: string, link?: string, linkLabel?: string, children: ReactNode }) {
  return <section className="panel"><div className="panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{link && <Link className="text-link" to={link}>{linkLabel} <ArrowUpRight size={15} /></Link>}</div>{children}</section>
}

export function QueryState({ query, empty, emptyText, children }: { query: { isPending: boolean, isError: boolean, error: unknown }, empty: boolean, emptyText: [string, string], children: ReactNode }) {
  if (query.isPending) return <Loading />
  if (query.isError) return <ErrorBox message={errorMessage(query.error)} />
  return empty ? <Empty title={emptyText[0]} description={emptyText[1]} /> : <>{children}</>
}

export function FeeSummary({ title, description, link, studentId, readOnly }: { title: string, description: string, link?: string, studentId?: string, readOnly?: boolean }) {
  const fees = useQuery<Row[]>({ queryKey: ['suite', 'fees'], queryFn: () => data('/fees') })
  const rows = (fees.data || []).filter(f => !studentId || f.studentId === studentId)
  const sum = (key: string) => rows.reduce((total, f) => total + Number(f[key] || 0), 0)
  const currency = rows[0]?.currency, outstanding = rows.filter(f => Number(f.balance) > 0).length
  return <Panel title={title} description={description} link={link} linkLabel={readOnly ? 'View ledger' : 'Open fees'}>
    <QueryState query={fees} empty={!rows.length} emptyText={['No fee charges yet', 'Issued charges and received payments will appear here.']}>
      <div className="kpi-row"><div><span>Billed after concessions</span><strong>{money(currency, sum('gross') - sum('concession'))}</strong></div><div><span>Received</span><strong>{money(currency, sum('paid'))}</strong></div><div><span>Outstanding</span><strong className={sum('balance') > 0 ? 'text-warn' : ''}>{money(currency, sum('balance'))}</strong></div></div>
      <p className="muted"><Wallet size={14} /> {outstanding} of {rows.length} charge{rows.length === 1 ? '' : 's'} with a balance due{readOnly ? ' · view only' : ''}</p>
    </QueryState>
  </Panel>
}

export function UpcomingExams({ classId, link, title = 'Upcoming exams' }: { classId?: string, link?: string, title?: string }) {
  const exams = useRecords('exams'), options = useOptions()
  const rows = (exams.data?.data || []).filter(e => String(e.date) >= today() && (!classId || e.classId === classId)).sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 5)
  return <Panel title={title} description="Scheduled from today onwards" link={link}>
    <QueryState query={exams} empty={!rows.length} emptyText={['No upcoming exams', 'Scheduled exams will appear here.']}>
      <ul className="dash-list">{rows.map(e => <li key={e.id}><span className="stat-icon blue"><ClipboardList size={17} /></span><div><strong>{e.name}</strong><small>{label(options.data, 'subjects', e.subjectId)} · {label(options.data, 'classes', e.classId)}</small></div><span className="tag">{String(e.date).slice(0, 10)}</span></li>)}</ul>
    </QueryState>
  </Panel>
}

export function TodayTimetable({ classIds, link }: { classIds?: string[], link?: string }) {
  const periods = useRecords('timetable'), options = useOptions(), day = weekday()
  const rows = (periods.data?.data || []).filter(p => p.day === day && (!classIds || classIds.includes(p.classId))).sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)))
  return <Panel title={"Today's timetable"} description={day} link={link} linkLabel="Full week">
    <QueryState query={periods} empty={!rows.length} emptyText={['No periods today', 'Timetable periods for ' + day + ' will appear here.']}>
      <ul className="dash-list">{rows.map(p => <li key={p.id}><span className="stat-icon teal"><CalendarCheck size={17} /></span><div><strong>{String(p.startsAt).slice(0, 5)}–{String(p.endsAt).slice(0, 5)} · {label(options.data, 'subjects', p.subjectId)}</strong><small>{label(options.data, 'classes', p.classId)}{p.room ? ' · Room ' + p.room : ''}</small></div></li>)}</ul>
    </QueryState>
  </Panel>
}

export function RecentCirculars({ link, canAcknowledge }: { link?: string, canAcknowledge?: boolean }) {
  const circulars = useRecords('circulars')
  const [done, setDone] = useState<Record<string, string>>({}), [error, setError] = useState('')
  async function acknowledge(id: string) {
    setError('')
    try { await client.post('/suite/circulars/' + id + '/acknowledge'); setDone({ ...done, [id]: 'Acknowledged' }) } catch (e) { setError(errorMessage(e)) }
  }
  const rows = (circulars.data?.data || []).slice(0, 4)
  return <Panel title="Circulars & notices" description="Latest from your school" link={link}>
    {error && <ErrorBox message={error} />}
    <QueryState query={circulars} empty={!rows.length} emptyText={['No circulars', 'School circulars addressed to you will appear here.']}>
      <div className="notice-list">{rows.map(c => <div className="notice-row" key={c.id}><span className="notice-icon teal"><Megaphone size={19} /></span><div><h3>{c.title}</h3><p>{String(c.message || '').slice(0, 110)}{String(c.message || '').length > 110 ? '…' : ''}</p><small>{c.dueDate ? 'Acknowledge by ' + String(c.dueDate).slice(0, 10) : 'For ' + c.audience}</small></div>{canAcknowledge && (done[c.id] ? <span className="status-tag active"><Check size={13} />{done[c.id]}</span> : <button className="button small secondary" onClick={() => acknowledge(c.id)}>Acknowledge</button>)}</div>)}</div>
    </QueryState>
  </Panel>
}
