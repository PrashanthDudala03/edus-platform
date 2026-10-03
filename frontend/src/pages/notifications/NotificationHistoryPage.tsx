import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import client, { errorMessage } from '../../api/client'
import { Empty, ErrorBox, Loading, PageHeader, Pagination } from '../../components/UI'
import { CHANNEL_LABELS, deliverySummary, sentAt, type HistoryDetail, type HistoryPage } from './templates'

// What EduOS sent in this school: the event, the wording used, how many people, how many read it and what each channel
// did. Read-only. The server limits it to this school and to roles that manage notifications, and returns a
// recipient's name and kind of account only.
const header=<PageHeader eyebrow="NOTIFICATION SETTINGS" title="Delivery history" description="What EduOS sent to your school community, and what happened to it."><Link className="button secondary" to="/notifications/templates">Notification wording</Link></PageHeader>
export default function NotificationHistoryPage(){
 const [page,setPage]=useState(1),[open,setOpen]=useState('')
 const list=useQuery<HistoryPage>({queryKey:['notification-history',page],queryFn:async()=>(await client.get('/notifications/history',{params:{page}})).data.data})
 const detail=useQuery<HistoryDetail>({queryKey:['notification-history-item',open],enabled:!!open,queryFn:async()=>(await client.get('/notifications/history/'+open)).data.data})
 if(list.isError)return <>{header}<ErrorBox message={errorMessage(list.error)}/></>
 if(!list.data)return <Loading/>
 return <>{header}
 <section className="panel notify-history" aria-label="Sent notifications">{list.data.items.length===0?<Empty title="Nothing sent yet" description="Notifications appear here once EduOS sends them."/>:<><div className="table-scroll"><table>
  <thead><tr><th>Sent</th><th>Notification</th><th>Title</th><th>Wording</th><th>People</th><th>Read</th><th>Delivery</th></tr></thead>
  <tbody>{list.data.items.map(n=><tr key={n.id}><td>{sentAt(n.createdAt)}</td><td><button type="button" className="text-link" aria-expanded={open===n.id} onClick={()=>setOpen(open===n.id?'':n.id)}>{n.template??n.type}</button></td><td>{n.title}</td>
   <td>{n.wording==='school'?`Your school's (version ${n.wordingVersion??1})`:'EduOS default'}</td><td>{n.recipients}</td><td>{n.read} of {n.recipients}</td><td>{deliverySummary(n)}</td></tr>)}</tbody></table></div>
  <Pagination page={list.data.page} total={list.data.totalCount} size={list.data.pageSize} onChange={next=>{setPage(next);setOpen('')}}/></>}</section>
 {open&&<section className="panel notify-history" aria-label="Recipients"><div className="panel-heading"><div><h2>Recipients</h2><p>{detail.data?.notification.title??'Loading…'}</p></div></div>
  {detail.isError?<ErrorBox message={errorMessage(detail.error)}/>:!detail.data?<Loading/>:<div className="table-scroll"><table>
   <thead><tr><th>Person</th><th>Account</th><th>Read</th><th>Channel</th><th>Status</th><th>Attempts</th><th>Problem</th></tr></thead>
   <tbody>{detail.data.recipients.map((r,i)=><tr key={i}><td>{r.name}</td><td>{r.scope}</td><td>{r.read?'Read':'Unread'}</td><td>{r.channel?CHANNEL_LABELS[r.channel]??r.channel:'None'}</td><td>{r.status??'None'}</td><td>{r.attempts??0}</td><td>{r.lastError??''}</td></tr>)}</tbody></table></div>}</section>}
 </>
}
