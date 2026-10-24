import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import client, { errorMessage } from '../../api/client'
import { Dialog, ErrorBox, Loading } from '../../components/UI'
import { useAuthStore } from '../../store/auth'
type Notice = {id:string,title:string,message:string,requiresAcknowledgement:boolean,canAcknowledge:boolean,acknowledgedAt:string|null}
export default function NoticeAcknowledgement({id,onClose}:{id:string,onClose:()=>void}){
 const user=useAuthStore(s=>s.user)!,cache=useQueryClient(),locked=useRef(false)
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false)
 const query=useQuery<Notice>({queryKey:['notifications','notice',user.schoolId,user.id,id],retry:false,staleTime:0,queryFn:async()=>(await client.get('/notifications/'+id+'/notice')).data.data})
 async function acknowledge(){
  if(locked.current||!query.data||confirmed||query.data.acknowledgedAt)return
  locked.current=true;setBusy(true);setError('')
  try{
   await client.post('/suite/circulars/'+query.data.id+'/acknowledge');setConfirmed(true)
   // The acknowledgement is already committed even if marking the inbox item read fails.
   try{await client.post('/notifications/'+id+'/read')}catch{setError('Acknowledgement saved. The notification could not be marked read; try opening it again.')}
   await Promise.all([cache.invalidateQueries({queryKey:['notifications']}),cache.invalidateQueries({queryKey:['suite','communications']})])
  }catch(e){setError(errorMessage(e))}finally{locked.current=false;setBusy(false)}
 }
 return <Dialog title="Review school notice" onClose={()=>!busy&&onClose()}>{query.isPending?<Loading/>:query.isError?<ErrorBox message={errorMessage(query.error)}/>:<div className="form-stack"><h3>{query.data.title}</h3><div className="com-message">{query.data.message}</div>
  {confirmed||query.data.acknowledgedAt?<p role="status">Acknowledged{query.data.acknowledgedAt?' on '+new Date(query.data.acknowledgedAt).toLocaleString():''}.</p>:query.data.requiresAcknowledgement?<p>Confirm only after reading the full notice. Your acknowledgement is recorded for your own account.</p>:<p>No acknowledgement is required.</p>}
  {query.data.requiresAcknowledgement&&!query.data.canAcknowledge&&!query.data.acknowledgedAt&&<p>Your role does not have permission to acknowledge notices.</p>}
 </div>}{error&&<ErrorBox message={error}/>}<div className="modal-footer"><button className="button secondary" disabled={busy} onClick={onClose}>Close</button>{query.data?.requiresAcknowledgement&&query.data.canAcknowledge&&!query.data.acknowledgedAt&&!confirmed&&<button className="button primary" disabled={busy} onClick={()=>void acknowledge()}>{busy?'Saving…':'Confirm acknowledgement'}</button>}</div></Dialog>
}
