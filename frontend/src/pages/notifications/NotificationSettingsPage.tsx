import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import client, { errorMessage } from '../../api/client'
import { PageHeader, ErrorBox, Loading } from '../../components/UI'
import { useAuthStore } from '../../store/auth'
type Setting = { key:string,name:string,description:string,implemented:boolean,enabled:boolean,version:number,warning:boolean }
type Change = { type:string,enabled:boolean,actor:string,changedAt:string }
export default function NotificationSettingsPage(){
 const user=useAuthStore(s=>s.user)!, cache=useQueryClient(), queryKey=['notification-settings',user.schoolId,user.id]
 const list=useQuery<Setting[]>({queryKey,queryFn:async()=>(await client.get('/notifications/settings')).data.data})
 const history=useQuery<Change[]>({queryKey:[...queryKey,'history'],queryFn:async()=>(await client.get('/notifications/settings/history')).data.data})
 const [pending,setPending]=useState<Setting|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
 async function save(row:Setting){setBusy(true);setError('');setMessage('');try{const result=await client.put('/notifications/settings/'+row.key,{enabled:!row.enabled,version:row.version,confirmRisk:row.warning&&row.enabled});setMessage(result.data.message);setPending(null);await cache.invalidateQueries({queryKey})}catch(e){setError(errorMessage(e));await cache.invalidateQueries({queryKey})}finally{setBusy(false)}}
 return <><PageHeader eyebrow="NOTIFICATION SETTINGS" title="School notification delivery" description="Control which new alerts your school sends. Wording and personal preferences are separate."/>
 <p>Enabled events still follow recipient permissions and personal preferences. Existing inbox items are kept when delivery is disabled.</p>
 {error&&<ErrorBox message={error}/>} {message&&<p role="status">{message}</p>}
 {pending&&<section className="panel" style={{padding:20,marginBottom:20}} role="alert"><h2>Disable {pending.name}?</h2><p>{pending.warning?'Urgent notices and notices requiring acknowledgement will also stop producing alerts. People can still read the original communication.':'New alerts for this event will stop for everyone in your school.'}</p><div className="toolbar-actions"><button className="button primary" disabled={busy} onClick={()=>void save(pending)}>Confirm disable</button><button className="button secondary" disabled={busy} onClick={()=>setPending(null)}>Cancel</button></div></section>}
 {list.isPending?<Loading/>:list.isError?<ErrorBox message={errorMessage(list.error)}/>:<section className="panel" style={{padding:20}}>{list.data.map(row=><div key={row.key} style={{display:'flex',gap:16,alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',padding:'16px 0',borderBottom:'1px solid var(--border)'}}><div style={{flex:'1 1 240px',minWidth:0}}><h3>{row.name}</h3><p>{row.description}</p>{!row.implemented&&<small>Not available yet</small>}</div><button className="button secondary" role="switch" aria-label={row.name} aria-checked={row.enabled} disabled={busy||!row.implemented} onClick={()=>row.enabled?setPending(row):void save(row)}>{row.enabled?'On':'Off'}</button></div>)}</section>}
 <section className="panel" style={{padding:20,marginTop:20}}><h2>Recent delivery changes</h2>{history.isPending?<Loading/>:history.isError?<ErrorBox message={errorMessage(history.error)}/>:!history.data.length?<p>No delivery changes yet.</p>:<ul>{history.data.map((change,i)=><li key={i}>{list.data?.find(row=>row.key===change.type)?.name||change.type}: {change.enabled?'enabled':'disabled'} by {change.actor} — {new Date(change.changedAt).toLocaleString()}</li>)}</ul>}</section>
 {user.permissions.includes('notifications.manage')&&<p><Link to="/notifications/templates">Edit notification wording</Link></p>}</>
}
