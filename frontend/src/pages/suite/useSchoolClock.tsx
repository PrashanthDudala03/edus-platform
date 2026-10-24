import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import client, { errorMessage } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { ErrorBox } from '../../components/UI'
import * as com from './communications'
import { schoolInstant, schoolLocal } from './schoolClock'
export function useSchoolClock(){
 const user=useAuthStore(s=>s.user)!
 const query=useQuery<{timeZone:string}>({queryKey:['suite','communications','clock',user.schoolId,user.id],retry:false,staleTime:60000,queryFn:async()=>(await client.get('/suite/communications/config')).data.data})
 const zone=typeof query.data?.timeZone==='string'?query.data.timeZone:'UTC'
 const scheduleIso=(local:string)=>schoolInstant(local,zone)
 const shortWhen=(iso:string)=>iso?new Intl.DateTimeFormat('en-GB',{timeZone:zone,day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso))+' ('+zone+')':'—'
 return {query,zone,scheduleIso,shortWhen,
  fromDetail:(d:com.Detail)=>({...com.fromDetail(d),publishAt:d.publishAt?schoolLocal(d.publishAt,zone):''}),
  recordBody:(c:com.Composition)=>com.recordBody({...c,publishAt:c.when==='schedule'?scheduleIso(c.publishAt):''}),
  composeProblems:(c:com.Composition,p:com.Perms)=>[...com.composeProblems({...c,publishAt:c.when==='schedule'?scheduleIso(c.publishAt):''},p),...(c.when==='schedule'&&(query.isPending||query.isError)?['School timezone could not be loaded. Try again before scheduling.']:[])],
  whenLabel:(i:com.Item)=>i.status==='Scheduled'?'Scheduled for '+shortWhen(i.publishAt):com.whenLabel(i)}
}
export function SchoolClockSettings({editable}:{editable:boolean}){
 const {query,zone}=useSchoolClock(),cache=useQueryClient(),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
 const zones=[...new Set(['UTC','Asia/Kolkata',...Intl.supportedValuesOf('timeZone')])].sort()
 async function save(){setBusy(true);setError('');setMessage('');try{await client.put('/suite/communications/config',{timeZone:selected||zone});await cache.invalidateQueries({queryKey:['suite','communications']});setSelected('');setMessage('School timezone saved. Existing scheduled instants stay unchanged.')}catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
 return <details className="panel" style={{padding:16,marginBottom:20}}><summary>School scheduling timezone: {query.isPending?'Loading…':query.isError?'Unavailable':zone}</summary>{query.isError&&<ErrorBox message={errorMessage(query.error)}/>}<p>Dates entered for scheduling use this school timezone. Existing scheduled instants stay unchanged when the timezone changes.</p>{editable&&<><label>School timezone<select value={selected||zone} disabled={busy||!query.isSuccess} onChange={e=>setSelected(e.target.value)}>{zones.map(z=><option key={z}>{z}</option>)}</select></label><button className="button secondary" disabled={busy||!selected} onClick={()=>void save()}>Save timezone</button></>}{error&&<ErrorBox message={error}/>} {message&&<p role="status">{message}</p>}</details>
}
