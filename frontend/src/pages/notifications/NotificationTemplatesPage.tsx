import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Info, RotateCcw, Save } from 'lucide-react'
import client, { errorMessage } from '../../api/client'
import { ErrorBox, Loading, PageHeader } from '../../components/UI'
import { CHANNEL_LABELS, insertVariable, startingText, statusNote, wordingSource, type Template, type Wording } from './templates'

// A school's own wording for the notifications EduOS sends. EduOS defaults are read-only here; saving creates wording
// for this school only, and resetting returns to the default. The server decides who may edit and checks every placeholder.
const header=<PageHeader eyebrow="NOTIFICATION SETTINGS" title="Notification wording" description="The words your school community reads when EduOS notifies them."><Link className="button secondary" to="/notifications/history">Delivery history</Link></PageHeader>
export default function NotificationTemplatesPage(){
 const cache=useQueryClient()
 const list=useQuery<Template[]>({queryKey:['notification-templates'],gcTime:0,queryFn:async()=>(await client.get('/notifications/templates')).data.data})
 const [key,setKey]=useState(''),[channel,setChannel]=useState('in-app'),[text,setText]=useState<Wording>({title:'',body:''}),[field,setField]=useState<'title'|'body'>('body')
 const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[preview,setPreview]=useState<Wording|null>(null)
 const template=list.data?.find(t=>t.key===key)??list.data?.[0],current=template?.channels.find(c=>c.channel===channel)
 // Opening a notification (or a saved change) shows the wording in force; typing is never overwritten.
 useEffect(()=>{if(template&&!dirty){setText(startingText(template,channel));setPreview(null)}},[template,channel])
 if(list.isError)return <>{header}<ErrorBox message={errorMessage(list.error)}/></>
 if(!template||!current)return <Loading/>
 const open=(next:string)=>{setKey(next);setDirty(false);setError('');setMessage('')}
 const change=(patch:Partial<Wording>)=>{setText(now=>({...now,...patch}));setDirty(true);setMessage('');setPreview(null)}
 async function run(work:()=>Promise<{data:{data:Template,message?:string}}>){
  setBusy(true);setError('');setMessage('')
  try{const saved=(await work()).data;cache.setQueryData<Template[]>(['notification-templates'],all=>all?.map(t=>t.key===saved.data.key?saved.data:t));setDirty(false);setPreview(null);setMessage(saved.message||'Saved.')}
  catch(e){setError(errorMessage(e))}finally{setBusy(false)}
 }
 async function show(){setBusy(true);setError('');try{setPreview((await client.post(`/notifications/templates/${template!.key}/preview`,{channel,...text})).data.data)}catch(e){setPreview(null);setError(errorMessage(e))}finally{setBusy(false)}}
 const own=current.override,path=`/notifications/templates/${template.key}`
 return <>{header}
 {error&&<ErrorBox message={error}/>}{message&&<div className="success-box" role="status">{message}</div>}
 <div className="home-manage"><section className="panel" aria-label="Notifications"><div className="panel-heading"><div><h2>Notifications</h2><p>Choose one to see or change its wording</p></div></div>
  <ol className="home-section-list">{list.data!.map(t=><li key={t.key} className={t.key===template.key?'active':''}>
   <button type="button" className="home-section-name" aria-current={t.key===template.key?'true':undefined} onClick={()=>open(t.key)}><span>{t.name}</span><small>{wordingSource(t,'in-app')}{t.sending?'':' · not sent yet'}</small></button></li>)}</ol></section>
 <section className="panel" aria-label={template.name}><div className="panel-heading"><div><h2>{template.name}</h2><p>{template.description}</p></div><span className={'status-tag'+(current.source==='school'?' active':'')}>{wordingSource(template,channel)}</span></div>
  <div className="home-editor">
   {!template.sending&&<div className="info-box"><Info size={18}/><span>{statusNote(template)}</span></div>}
   <label>Channel<select value={channel} onChange={e=>{setChannel(e.target.value);setDirty(false)}}>{template.channels.map(c=><option key={c.channel} value={c.channel} disabled={!c.available}>{CHANNEL_LABELS[c.channel]??c.channel}{c.available?'':' (not available yet)'}</option>)}</select></label>
   <label>Title<input value={text.title} maxLength={current.titleMax} onFocus={()=>setField('title')} onChange={e=>change({title:e.target.value})}/></label>
   <label>Message<textarea value={text.body} maxLength={current.bodyMax} rows={4} onFocus={()=>setField('body')} onChange={e=>change({body:e.target.value})}/></label>
   <div className="template-variables"><span className="home-field-label">Details you can include</span><p>Choose one to add it to the {field==='title'?'title':'message'}. EduOS fills it in when the notification is sent.</p>
    <ul>{template.variables.map(v=><li key={v.name}><button type="button" className="button secondary small" title={'For example: '+v.sample} onClick={()=>change({[field]:insertVariable(text[field],v.name)})}>{`{{${v.name}}}`}</button><span>{v.description}</span></li>)}</ul></div>
   {preview&&<div className="template-preview" role="status" aria-label="Preview"><small>Preview with sample details</small><strong>{preview.title}</strong>{preview.body&&<p>{preview.body}</p>}</div>}
   <div className="template-actions"><button type="button" className="button secondary" disabled={busy} onClick={show}><Eye size={16}/>Preview</button>
    <button type="button" className="button primary" disabled={busy||!dirty} onClick={()=>run(()=>client.put(path,{channel,...text,version:own?.version}))}><Save size={16}/>Save for our school</button>
    {own&&<button type="button" className="button secondary" disabled={busy} onClick={()=>run(()=>client.put(path+'/enabled',{channel,enabled:!own.enabled}))}>{own.enabled?'Use the EduOS default for now':'Use our wording'}</button>}
    {own&&<button type="button" className="button secondary" disabled={busy} onClick={()=>run(()=>client.delete(path,{params:{channel}}))}><RotateCcw size={16}/>Reset to EduOS default</button>}</div>
   {current.default&&<div className="template-default"><span className="home-field-label">EduOS default</span><strong>{current.default.title}</strong><p>{current.default.body}</p></div>}
  </div></section></div></>
}
