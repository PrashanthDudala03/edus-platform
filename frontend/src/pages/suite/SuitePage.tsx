import { GuardianLinkCheck } from '../../components/GuardianReview'
import { FormEvent, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Eye, Upload, FileDown, Check, Printer, ArrowUpRight, Archive } from 'lucide-react'
import client, {errorMessage} from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { Dialog, Empty, ErrorBox, Loading, PageHeader, Pagination } from '../../components/UI'
import { data, Field, Module, Options, Row, label, workbook, printSchoolDocument } from './helpers'
import { FeesPage, ReportsPage, AllocationPage } from './SuiteTools'
import HomeworkPage from './HomeworkPage'
import ExamsPage from './ExamsPage'
import { RegisterPage } from './AttendancePages'
import { ForbiddenPage } from '../ForbiddenPage'
import { canVisit } from '../../access'
import { isAdministrator, isLeadership } from '../../roles'
export function SchoolModules(){
 const user=useAuthStore(s=>s.user),role=user?.roles?.[0]||''
 const catalog=useQuery<Module[]>({queryKey:['suite','catalog'],queryFn:()=>data('/catalog')})
 const groups=[...new Set(catalog.data?.map(m=>m.group)||[])]
 return <><PageHeader eyebrow={role.toUpperCase()+' WORKSPACE'} title={role==='Parent'?'Your family’s school day':role==='Student'?'Your learning space':role==='Teacher'?'Your teaching workspace':'Your school, connected.'} description="Academic records, daily work, and school operations in one place."/>
 <div className="info-box">Access is based on your role and linked student or teacher profile. Contact your administrator if an assigned class or student is missing.</div>
 {catalog.isPending?<Loading/>:catalog.isError?<ErrorBox message={errorMessage(catalog.error)}/>:groups.map(group=><section key={group} className="suite-group"><h2>{group}</h2><div className="module-grid">{catalog.data.filter(m=>m.group===group).map(m=><Link className="panel module-card" key={m.kind} to={'/suite/'+m.kind}><span className="eyebrow">{m.canWrite?'MANAGE & REVIEW':'YOUR RECORDS'}</span><h3>{m.title}</h3><ArrowUpRight size={18}/></Link>)}</div></section>)}
 <section className="suite-group"><h2>Connected tools</h2><div className="module-grid">{(role==='Teacher'?[['register','Student register'],['reports','Reports & report cards']]:role==='Parent'||role==='Student'?[['fees','Fee balances & receipts'],['reports','Report cards & attendance']]:role==='Principal'?[['fees','Fees & receipts (view only)'],['reports','Reports & report cards'],['register','Student attendance']]:[['allocation','Class allocation & promotion'],['fees','Fees & receipts'],['reports','Reports & Excel tools'],['register','Student attendance']]).filter(([path])=>canVisit(user,'/suite/'+path)).map(([path,title])=><Link key={path} className="panel module-card" to={'/suite/'+path}><h3>{title}</h3><ArrowUpRight size={18}/></Link>)}</div></section></>
}
// Connected tools are shown only to roles their endpoints accept; the API still decides every request.
const toolRoles:Record<string,string[]>={fees:['Administrator','Principal','Parent','Student'],allocation:['Administrator'],register:['Administrator','Principal','Teacher'],reports:['Administrator','Principal','Teacher','Parent','Student']}
export default function SuiteRouter(){const{kind}=useParams(),user=useAuthStore(s=>s.user);if(kind&&!canVisit(user,'/suite/'+kind))return <ForbiddenPage/>;return kind==='fees'?<FeesPage/>:kind==='reports'?<ReportsPage/>:kind==='allocation'?<AllocationPage/>:kind==='register'?<RegisterPage/>:kind==='homework'?<HomeworkPage/>:kind==='exams'||kind==='marks'?<ExamsPage key={kind} kind={kind}/>:<RecordPage key={kind} kind={kind||''}/>}
function RecordPage({kind}:{kind:string}){
 const cache=useQueryClient(),role=useAuthStore(s=>s.user?.roles[0]),admin=isAdministrator(role),leader=isLeadership(role)
 const [linkDraft,setLinkDraft]=useState<Record<string,string>>()
 const canCheckGuardian=useAuthStore(s=>!!s.user?.permissions.includes("users.view")&&!!s.user?.permissions.includes("account-links.manage"))
 const [page,setPage]=useState(1),[search,setSearch]=useState(''),[edit,setEdit]=useState<Row|null|undefined>(),[detail,setDetail]=useState<Row|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
 const catalog=useQuery<Module[]>({queryKey:['suite','catalog'],queryFn:()=>data('/catalog')})
 const options=useQuery<Options>({queryKey:['suite','options'],queryFn:()=>data('/options')})
 const module=catalog.data?.find(m=>m.kind===kind)
 const rows=useQuery<{data:Row[],totalCount:number}>({queryKey:['suite',kind,page,search],queryFn:()=>data('/records/'+kind,{page,search}),enabled:!!module})
 async function refresh(){await cache.invalidateQueries();setError('')}
 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setError('');setBusy(true);const values={...edit,...Object.fromEntries(new FormData(event.currentTarget))}
  try{if(edit)await client.put('/suite/records/'+kind+'/'+edit.id,values);else await client.post('/suite/records/'+kind,values);setEdit(undefined);setMessage('Record saved.');await refresh()}catch(e){setError(errorMessage(e))}finally{setBusy(false)}
 }
 async function action(row:Row,action:string){
  setBusy(true);setError('')
  try{
   if(action==='archive'){if(!window.confirm('Archive this record? Its stored history will be retained.'))return;await client.delete('/suite/records/'+kind+'/'+row.id);setMessage('Record archived.')}
   if(action==='accept'){if(!window.confirm('Accept this admission and create the linked student and guardian records?'))return;await client.post('/suite/admissions/'+row.id+'/accept');setMessage('Admission accepted and student allocated.')}
   if(action==='acknowledge'){await client.post('/suite/circulars/'+row.id+'/acknowledge');setMessage('Acknowledgement recorded.')}
   if(action==='print')printSchoolDocument('certificate',await data('/certificates/'+row.id+'/print'))
   await refresh()
  }catch(e){setError(errorMessage(e))}finally{setBusy(false)}
 }
 if(catalog.isPending)return <Loading/>
 if(catalog.isError)return <ErrorBox message={errorMessage(catalog.error)}/>
 if(!module)return <Empty title="Module unavailable" description="Your current role does not have access to this module."/>
 const visibleFields=kind==='timetable'?['classId','day','startsAt','endsAt','subjectId','teacherId','room'].map(key=>module.fields.find(f=>f.key===key)!):module.fields.slice(0,4)
 const canArchive=admin&&['timetable','teaching-assignments','leave-requests','homework','submissions','circulars','calendar','messages','account-links','staff-attendance'].includes(kind)
 const sibling=catalog.data!.filter(m=>m.group===module.group)
 return <><PageHeader eyebrow={module.group.toUpperCase()} title={module.title} description="Connected to your school records, with changes recorded in the activity history.">{module.canWrite&&<button className="button primary" onClick={()=>{setError('');setLinkDraft(undefined);setEdit(null)}}><Plus size={17}/>Add record</button>}</PageHeader>
 <div className="module-tabs"><Link to="/suite">All modules</Link>{sibling.map(m=><Link key={m.kind} className={m.kind===kind?'selected':''} to={'/suite/'+m.kind}>{m.title}</Link>)}
 {module.group==='Academics'&&admin&&<Link to="/suite/allocation">Allocation & promotion</Link>}{module.group==='Fees'&&leader&&<Link to="/suite/fees">Charges & payments</Link>}{module.group==='Exams'&&<Link to="/suite/reports">Report cards</Link>}</div>
 {kind==='admissions'&&<div className="info-box">Create the academic year and class first. Save an application as Submitted, attach documents, then accept it to create the student, guardian, and class allocation together.</div>}
 {kind==='messages'&&<div className="info-box">Messages are delivered within linked accounts in this app. No email or SMS is sent.</div>}
 {kind==='account-links'&&<div className="info-box">Create the staff, parent, or student account in School settings first. A parent can have several student links; a teacher or student account has one profile link.</div>}
 {error&&edit===undefined&&<ErrorBox message={error}/>} {message&&<div className="success-box" role="status">{message}</div>}
 <section className="panel"><div className="directory-toolbar"><div><h2>{module.title}</h2><p>{rows.data?.totalCount??0} saved records</p></div><div className="toolbar-actions"><input aria-label="Search module records" maxLength={100} value={search} placeholder="Search records…" onChange={e=>{setSearch(e.target.value);setPage(1)}}/><button className="button secondary" disabled={!rows.data?.data.length} onClick={()=>workbook(kind+'-page-'+page,rows.data!.data.map(r=>Object.fromEntries(module.fields.map(f=>[f.key,label(options.data,f.source,r[f.key])]))),module.fields)}><FileDown size={16}/>Excel · page</button></div></div>
 {rows.isPending?<Loading/>:rows.isError?<ErrorBox message={errorMessage(rows.error)}/>:rows.data?.data.length?<div className="table-scroll"><table><thead><tr>{visibleFields.map(f=><th key={f.key}>{f.label}</th>)}<th>Status / actions</th></tr></thead><tbody>{rows.data.data.map(row=><tr key={row.id}>{visibleFields.map(f=><td key={f.key} className="truncate-cell">{label(options.data,f.source,row[f.key])}</td>)}<td><div className="row-actions">{row.status&&<span className="status-tag active">{row.status}</span>}{canArchive&&<button className="icon-button" aria-label="Archive record" disabled={busy} onClick={()=>action(row,"archive")}><Archive size={16}/></button>}<button className="icon-button" aria-label="View record and attachments" onClick={()=>setDetail(row)}><Eye size={17}/></button>{module.canWrite&&!(kind==='admissions'&&row.status==='Accepted')&&kind!=='certificates'&&<button className="icon-button" aria-label="Edit record" onClick={()=>{setError('');setLinkDraft(undefined);setEdit(row)}}><Pencil size={16}/></button>}{kind==='admissions'&&row.status==='Submitted'&&admin&&<button className="button small primary" disabled={busy} onClick={()=>action(row,'accept')}>Accept</button>}{kind==='circulars'&&<button className="button small secondary" disabled={busy} onClick={()=>action(row,'acknowledge')}><Check size={14}/>Acknowledge</button>}{kind==='certificates'&&<button className="button small secondary" onClick={()=>action(row,'print')}><Printer size={14}/>Print / PDF</button>}</div></td></tr>)}</tbody></table></div>:<Empty title="No records yet" description={module.canWrite?'Add your first record to get started.':'Records assigned to your profile will appear here.'}/>}
 <Pagination page={page} total={rows.data?.totalCount||0} onChange={setPage}/></section>
 {edit!==undefined&&<Dialog title={(edit?'Edit ':'Add ')+module.title} onClose={()=>!busy&&setEdit(undefined)}><form onSubmit={save} onChange={e=>{if(kind==="account-links")setLinkDraft(Object.fromEntries(new FormData(e.currentTarget)) as Record<string,string>)}}>{error&&<ErrorBox message={error}/>}<div className="form-grid">{module.fields.filter(f=>!(kind==='submissions'&&!leader&&role!=='Teacher'&&['feedback','grade'].includes(f.key))).map(f=><SuiteInput key={f.key} field={f} options={options.data} value={edit?.[f.key]} readOnly={kind==='submissions'&&role==='Teacher'&&!['feedback','grade'].includes(f.key)||kind==='leave-requests'&&role==='Teacher'&&['status','approvalRemark'].includes(f.key)}/>)}</div>{kind==="account-links"&&canCheckGuardian&&!['student','teacher'].includes((linkDraft??edit)?.relationship)&&!(linkDraft??edit)?.teacherId&&<GuardianLinkCheck userId={(linkDraft??edit)?.userId} studentId={(linkDraft??edit)?.studentId}/>}<div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={()=>setEdit(undefined)}>Cancel</button><button className="button primary" disabled={busy}>{busy?'Saving…':'Save record'}</button></div></form></Dialog>}
 {detail&&<Dialog title={module.title+' · record'} onClose={()=>setDetail(null)}><dl className="record-details">{module.fields.map(f=><div key={f.key}><dt>{f.label}</dt><dd>{label(options.data,f.source,detail[f.key])}</dd></div>)}</dl>{kind==="account-links"&&canCheckGuardian&&detail.relationship==="parent"&&<GuardianLinkCheck userId={detail.userId} studentId={detail.studentId}/>}
 {['admissions','homework','submissions','circulars','school-config'].includes(kind)&&<Attachments recordId={detail.id} canUpload={module.canWrite}/>}
 {kind==='circulars'&&leader&&<Acknowledgements id={detail.id}/>}
 </Dialog>}</>
}
export function SuiteInput({field:f,options,value,readOnly=false}:{field:Field,options?:Options,value?:any,readOnly?:boolean}){
 const defaultValue=value??(f.key==='status'&&f.options?.includes('Pending')?'Pending':f.type==='money'?'0':'')
 return <label className={f.type==='textarea'?'full-width':''}>{f.label}{!f.required&&<span className="optional"> (optional)</span>}
 {f.type==='reference'||f.type==='select'?<select name={f.key} required={f.required} defaultValue={defaultValue} disabled={readOnly}><option value="">Select…</option>{f.type==='reference'?options?.[f.source!]?.map(o=><option key={o.id} value={o.id}>{o.label}</option>):f.options?.map(o=><option key={o}>{o}</option>)}</select>:f.type==='textarea'?<textarea name={f.key} defaultValue={defaultValue} required={f.required} maxLength={4000} readOnly={readOnly} rows={4}/>:<input name={f.key} type={f.type==='money'?'number':f.type} defaultValue={defaultValue} required={f.required} readOnly={readOnly} step={f.type==='money'||f.type==='number'?'0.01':undefined} min={f.type==='money'||f.type==='number'?0:undefined} maxLength={255}/>}
 {readOnly&&<input type="hidden" name={f.key} value={defaultValue}/>}</label>
}
export function Attachments({recordId,canUpload}:{recordId:string,canUpload:boolean}){
 const cache=useQueryClient(),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const list=useQuery<Row[]>({queryKey:['suite','documents',recordId],queryFn:()=>data('/documents',{recordId})})
 async function upload(file:File){setError('');if(file.size>8*1024*1024){setError('Choose a file smaller than 8 MB.');return}setBusy(true);try{const body=new FormData();body.append('file',file);await client.post('/suite/documents',body,{params:{recordId}});await cache.invalidateQueries({queryKey:['suite','documents',recordId]})}catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
 async function download(doc:Row){try{const response=await client.get('/suite/documents/'+doc.id,{responseType:'blob'}),url=URL.createObjectURL(response.data);const a=document.createElement('a');a.href=url;a.download=doc.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){setError(errorMessage(e))}}
 return <section className="attachment-box"><h3>Documents & attachments</h3><p className="muted">PDF, PNG, or JPEG · up to 8 MB each · files stay inside your school workspace.</p>{error&&<ErrorBox message={error}/>} {list.isError&&<ErrorBox message={errorMessage(list.error)}/>} {list.data?.map(doc=><button key={doc.id} className="attachment-link" onClick={()=>download(doc)}><FileDown size={16}/>{doc.name}<small>{Math.ceil(doc.length/1024)} KB</small></button>)}{canUpload&&<label className="upload-button"><Upload size={16}/>{busy?'Uploading…':'Attach document'}<input type="file" accept=".pdf,.png,.jpg,.jpeg" disabled={busy} onChange={e=>{if(e.target.files?.[0])upload(e.target.files[0]);e.target.value=''}}/></label>}</section>
}
function Acknowledgements({id}:{id:string}){
 const list=useQuery<Row[]>({queryKey:['suite','ack',id],queryFn:()=>data('/circulars/'+id+'/acknowledgements')})
 return <div className="attachment-box"><h3>Acknowledgements</h3>{list.isError?<ErrorBox message={errorMessage(list.error)}/>:list.data?.length?list.data.map((r,i)=><p key={i}>{r.name} · {new Date(r.acknowledgedAt).toLocaleString()}</p>):<p className="muted">No acknowledgements recorded yet.</p>}</div>
}
