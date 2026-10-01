import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import client, { errorMessage } from '../api/client'
import { ErrorBox, Loading } from './UI'

type StudentHint = {id:string,label:string,guardianName:string|null,guardianEmail:string|null,status:string}
type Mismatch = {linkId:string,accountName:string,accountEmail:string|null,studentName:string,guardianName:string|null,guardianEmail:string|null,status:string}
const explanation='Directory email matches are suggestions, not proof of guardianship. Verify the relationship before linking. These checks do not change portal access.'

function useGuardianHints(userId?:string,signupRequestId?:string,targetSchool?:string){
 return useQuery<StudentHint[]>({queryKey:['guardian-review',userId,signupRequestId,targetSchool],enabled:!!(userId||signupRequestId),queryFn:async()=>(await client.get('/control/guardian-review',{params:{userId,signupRequestId,targetSchool}})).data.data})
}
function Hint({student}:{student:StudentHint|undefined}){
 return student?<p role="status"><strong>{student.status==='Match'?'Guardian email matches':student.status==='Mismatch'?'Guardian email mismatch':student.status}</strong><br/>Directory guardian: {student.guardianName||'Not available'}{student.guardianEmail?' · '+student.guardianEmail:''}</p>:null
}

export function GuardianStudentPicker({signupRequestId,targetSchool}:{signupRequestId:string,targetSchool?:string}){
 const [studentId,setStudentId]=useState(''),query=useGuardianHints(undefined,signupRequestId,targetSchool)
 return <div><label>Verified student record<select name="studentId" value={studentId} onChange={e=>setStudentId(e.target.value)}><option value="">Link later (no child access)</option>{query.data?.map(s=><option key={s.id} value={s.id}>{s.label} — {s.status==='Match'?'Suggested: guardian email matches':s.status}</option>)}</select></label>{query.isFetching&&<p>Checking directory guardians…</p>}{query.isError&&<ErrorBox message={errorMessage(query.error)}/>}<Hint student={query.data?.find(s=>s.id===studentId)}/><p className="muted">{explanation}</p></div>
}

export function GuardianLinkCheck({userId,studentId}:{userId?:string,studentId?:string}){
 const query=useGuardianHints(userId)
 if(!userId)return <p className="muted">Select an account to check directory guardian matches.</p>
 return <div className="info-box" style={{display:'block'}}><strong>Directory guardian check</strong>{query.isFetching&&<p>Checking guardian…</p>}{query.isError?<ErrorBox message={errorMessage(query.error)}/>:<><Hint student={query.data?.find(s=>s.id===studentId)}/>{studentId&&query.isSuccess&&!query.data.some(s=>s.id===studentId)&&<p>Student unavailable in this school.</p>}<p>Suggested students: {query.data?.filter(s=>s.status==='Match').map(s=>s.label).join(', ')||'No guardian email matches found.'}</p></>}<p className="muted">{explanation}</p></div>
}

export function GuardianMismatchOverview({targetSchool}:{targetSchool?:string}){
 const [page,setPage]=useState(1)
 const query=useQuery<{rows:Mismatch[],hasMore:boolean}>({queryKey:['guardian-mismatches',targetSchool,page],queryFn:async()=>(await client.get('/control/guardian-mismatches',{params:{targetSchool,page}})).data.data})
 return <section className="panel" style={{padding:24,marginTop:20}}><h2>Parent links needing review</h2><p>Compare portal links with the directory guardian. A mismatch can be legitimate, such as a second parent; verify before changing records.</p>{query.isPending?<Loading/>:query.isError?<ErrorBox message={errorMessage(query.error)}/>:<>{query.data.rows.length?<div className="table-scroll"><table><thead><tr><th>Portal account</th><th>Student</th><th>Directory guardian</th><th>Check</th></tr></thead><tbody>{query.data.rows.map(r=><tr key={r.linkId}><td>{r.accountName}<br/>{r.accountEmail}</td><td>{r.studentName}</td><td>{r.guardianName||'Unavailable'}<br/>{r.guardianEmail}</td><td>{r.status}</td></tr>)}</tbody></table></div>:<p>No mismatches on this page.</p>}<div className="toolbar-actions"><button className="button secondary" disabled={page===1} onClick={()=>setPage(page-1)}>Previous</button><span>Page {page}</span><button className="button secondary" disabled={!query.data.hasMore} onClick={()=>setPage(page+1)}>Next</button></div></>}{!targetSchool&&<p><Link to="/suite/account-links">Review account profile links</Link></p>}</section>
}
