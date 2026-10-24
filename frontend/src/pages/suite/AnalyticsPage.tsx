import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileDown, RefreshCw, ArrowUpRight } from 'lucide-react'
import { useAuthStore } from '../../store/auth'
import { ErrorBox, Loading, PageHeader, Empty, today } from '../../components/UI'
import { errorMessage } from '../../api/client'
import { data, workbook } from './helpers'

type ClassRow={className:string,students:number,present:number,late:number,absent:number,excused:number,marked:number,percent:number|null,low:number}
type Fees={collectedToday:number,collectedThisMonth:number,totals:{outstanding:number,overdue:number,currency:string},byClass:{class:string,outstanding:number,overdue:number,paid:number}[]}
type Operations={library?:{titles:number,issued:number,overdue:number},inventory?:{items:number,assigned:number},transport?:{routes:number,passengers:number,capacity:number}}
export default function AnalyticsPage(){
 const user=useAuthStore(s=>s.user),can=(p:string)=>!!user?.permissions.includes(p)
 const [month,setMonth]=useState(today().slice(0,7)),[exportError,setExportError]=useState('')
 const attendance=useQuery({queryKey:['analytics','attendance',user?.schoolId,month],enabled:can('attendance.view'),queryFn:()=>data<{classes:ClassRow[]}>('/reports/attendance/classes',{month})})
 const admissions=useQuery({queryKey:['analytics','admissions',user?.schoolId],enabled:can('admissions.view'),queryFn:()=>data<{counts:Record<string,number>}>('/admissions/pipeline')})
 const fees=useQuery({queryKey:['analytics','fees',user?.schoolId],enabled:can('fees.view'),queryFn:()=>data<Fees>('/fees/summary')})
 const operations=useQuery({queryKey:['analytics','operations',user?.schoolId],queryFn:()=>data<Operations>('/analytics/operations')})
 const classes=attendance.data?.classes||[],counts=admissions.data?.counts||{}
 const marked=classes.reduce((n,c)=>n+c.marked,0),present=classes.reduce((n,c)=>n+c.present+c.late,0)
 const money=(v:number)=>`${fees.data?.totals.currency||''} ${Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2})}`
 async function download(){setExportError('');try{await workbook('school-analytics-'+month,[
  ...classes.map(c=>({area:'Attendance',period:month,label:c.className,value:c.marked?c.percent:null,unit:'percent',detail:c.low+' below 75%; '+c.marked+' marked entries'})),
  ...Object.entries(counts).map(([label,value])=>({area:'Admissions',period:'Current pipeline',label,value,unit:'applications',detail:''})),
  ...(fees.data?[{area:'Fees',period:'Current balances',label:'Outstanding',value:fees.data.totals.outstanding,unit:fees.data.totals.currency,detail:''},{area:'Fees',period:'Current balances',label:'Overdue',value:fees.data.totals.overdue,unit:fees.data.totals.currency,detail:''}]:[]),
  ...Object.entries(operations.data||{}).flatMap(([area,values])=>Object.entries(values).map(([label,value])=>({area,period:'Current',label,value,unit:'count',detail:''})))
 ])}catch(e){setExportError(errorMessage(e))}}
 const queries=[attendance,admissions,fees,operations],busy=queries.some(q=>q.isFetching)
 return <><PageHeader eyebrow="SCHOOL INTELLIGENCE" title="Analytics & insights" description="Live school records, connected across admissions, attendance, finance, and operations."><button className="button secondary" disabled={busy} onClick={()=>queries.forEach(q=>{if(q===operations||(q===attendance&&can('attendance.view'))||(q===admissions&&can('admissions.view'))||(q===fees&&can('fees.view')))void q.refetch()})}><RefreshCw size={16}/>Refresh</button><button className="button primary" disabled={!queries.some(q=>q.data)} onClick={download}><FileDown size={16}/>Export insights</button></PageHeader>
 {exportError&&<ErrorBox message={exportError}/>}
 <div className="stats-grid">
  {can('attendance.view')&&<section className="stat-card"><h2>Monthly attendance</h2><strong>{marked?Math.round(present/marked*100)+'%':'—'}</strong><p>{month} · present and late / marked entries</p></section>}
  {can('admissions.view')&&<section className="stat-card"><h2>Applications in review</h2><strong>{admissions.data?(counts.Submitted||0)+(counts['Under Review']||0):'—'}</strong><p>Current pipeline · submitted and under review</p></section>}
  {can('fees.view')&&<><section className="stat-card"><h2>Outstanding fees</h2><strong style={{fontSize:24}}>{fees.data?money(fees.data.totals.outstanding):'—'}</strong><p>Current ledger balance</p></section><section className="stat-card"><h2>Overdue fees</h2><strong style={{fontSize:24}}>{fees.data?money(fees.data.totals.overdue):'—'}</strong><p>Current ledger · past due date</p></section></>}
 </div>
 <div className="dashboard-grid">
 {can('attendance.view')&&<section className="panel"><div className="panel-heading"><div><h2>Attendance by class</h2><p>Low attendance means below 75% of marked days.</p></div><label>Month<input type="month" required aria-label="Attendance report month" value={month} onChange={e=>{if(/^\d{4}-\d{2}$/.test(e.target.value))setMonth(e.target.value)}}/></label></div>{attendance.isPending?<Loading/>:attendance.isError?<ErrorBox message={errorMessage(attendance.error)}/>:!classes.length?<Empty title="No attendance data" description="Class reports appear after student records are created."/>:<div className="table-scroll"><table><thead><tr><th>Class</th><th>Students</th><th>Attendance</th><th>Below 75%</th></tr></thead><tbody>{classes.map(c=><tr key={c.className}><td>{c.className}</td><td>{c.students}</td><td>{c.marked?c.percent+'%':'Not marked'}</td><td>{c.low}</td></tr>)}</tbody></table></div>}<Link className="panel-link" to="/suite/reports">Open detailed reports <ArrowUpRight size={16}/></Link></section>}
 {can('admissions.view')&&<section className="panel"><div className="panel-heading"><div><h2>Admissions pipeline</h2><p>Current applications across all academic years</p></div></div>{admissions.isPending?<Loading/>:admissions.isError?<ErrorBox message={errorMessage(admissions.error)}/>:<div className="class-bars">{Object.entries(counts).map(([status,count])=><div key={status}><span>{status}</span><div><i style={{width:(count/Math.max(1,...Object.values(counts))*100)+'%'}}/></div><strong>{count}</strong></div>)}</div>}<Link className="panel-link" to="/suite/admissions">Manage applications <ArrowUpRight size={16}/></Link></section>}
 {can('fees.view')&&<section className="panel"><div className="panel-heading"><div><h2>Fee collection</h2><p>Current balances and collection totals</p></div></div>{fees.isPending?<Loading/>:fees.isError?<ErrorBox message={errorMessage(fees.error)}/>:<><dl className="record-details" style={{padding:'0 24px 20px'}}><div><dt>Collected today</dt><dd>{money(fees.data.collectedToday)}</dd></div><div><dt>Collected this calendar month</dt><dd>{money(fees.data.collectedThisMonth)}</dd></div></dl><div className="table-scroll"><table><thead><tr><th>Class</th><th>Outstanding</th><th>Overdue</th></tr></thead><tbody>{fees.data.byClass.map(c=><tr key={c.class}><td>{c.class||'Unallocated'}</td><td>{money(c.outstanding)}</td><td>{money(c.overdue)}</td></tr>)}</tbody></table></div></>}<Link className="panel-link" to="/suite/fees">Open fee ledger <ArrowUpRight size={16}/></Link></section>}
 <section className="panel"><div className="panel-heading"><div><h2>School operations</h2><p>Live library, inventory, and transport figures</p></div></div>{operations.isPending?<Loading/>:operations.isError?<ErrorBox message={errorMessage(operations.error)}/>:<ul className="dash-list">
 {operations.data.library&&<li><div><strong>Library</strong><small>{operations.data.library.titles} titles · {operations.data.library.issued} issued · {operations.data.library.overdue} overdue</small></div><Link className="text-link" to="/suite/library-loans">Open loans <ArrowUpRight size={15}/></Link></li>}
 {operations.data.inventory&&<li><div><strong>Inventory</strong><small>{operations.data.inventory.items} item types · {operations.data.inventory.assigned} units assigned</small></div><Link className="text-link" to="/suite/inventory-items">Open inventory <ArrowUpRight size={15}/></Link></li>}
 {operations.data.transport&&<li><div><strong>Transport</strong><small>{operations.data.transport.routes} active routes · {operations.data.transport.passengers} / {operations.data.transport.capacity} seats assigned</small></div><Link className="text-link" to="/suite/transport-assignments">Open transport <ArrowUpRight size={15}/></Link></li>}
 {!Object.keys(operations.data).length&&<li>No operations permissions assigned.</li>}</ul>}</section>
 </div></>
}
