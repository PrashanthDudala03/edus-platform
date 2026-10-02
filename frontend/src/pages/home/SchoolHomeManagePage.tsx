import { ReactNode, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Eye, EyeOff, Image as ImageIcon, Info, Plus, Save, Send, Trash2, Upload } from 'lucide-react'
import client, { errorMessage } from '../../api/client'
import { ErrorBox, Loading, PageHeader } from '../../components/UI'
import { HomeImage } from './SchoolHomeView'
import { CATEGORIES, POSITIONS, SECTION_HINTS, SECTION_LABELS, STAT_SOURCES, DEFAULT_BRAND, brandTheme, move, type Draft, type SectionKey } from './schoolHome'
type State={version:number,published:boolean,publishedAt:string|null,pending:boolean}
type Manage=State&{draft:Draft,teachers:{id:string,label:string}[]}
const title=(text:string)=>text.slice(0,1).toUpperCase()+text.slice(1)
function Field({label,value,onChange,max,area,placeholder,type}:{label:string,value:string,onChange:(value:string)=>void,max:number,area?:boolean,placeholder?:string,type?:string}){
 return <label>{label}{area?<textarea value={value} maxLength={max} rows={4} placeholder={placeholder} onChange={e=>onChange(e.target.value)}/>:<input type={type||'text'} value={value} maxLength={max} placeholder={placeholder} min={type==='number'?0:undefined} step={type==='number'?'any':undefined} onChange={e=>onChange(e.target.value)}/>}</label>
}
function Note({children}:{children:ReactNode}){return <div className="info-box"><Info size={18}/><span>{children}</span></div>}
// Uploads go to the School Home image store; the server accepts only real PNG or JPEG files and keeps them inside this school.
const imageProblem=(file:File)=>!['image/png','image/jpeg'].includes(file.type)?'Choose a PNG or JPEG image.':file.size>5*1024*1024?'Choose an image smaller than 5 MB.':''
async function sendImage(file:File){const body=new FormData();body.append('file',file);return (await client.post('/suite/home/images',body)).data.data.id as string}
function ImageField({label,id,onChange,position,onPosition,hint}:{label:string,id:string,onChange:(id:string)=>void,position?:string,onPosition?:(position:string)=>void,hint?:string}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),input=useRef<HTMLInputElement>(null)
 async function upload(file:File|undefined){
  if(!file)return;const problem=imageProblem(file);setError(problem);if(problem)return
  setBusy(true);try{onChange(await sendImage(file))}catch(e){setError(errorMessage(e))}finally{setBusy(false)}
 }
 return <div className="home-image-field"><span className="home-field-label">{label}</span><div className="home-image-row">
  {id?<HomeImage id={id} alt={label+' preview'} className="home-thumb" position={position}/>:<span className="home-thumb home-thumb-empty" aria-hidden="true"><ImageIcon size={20}/></span>}
  <div className="home-image-actions"><button type="button" className="button secondary small" disabled={busy} onClick={()=>input.current?.click()}><Upload size={15}/>{busy?'Uploading…':id?'Replace '+label.toLowerCase():'Upload '+label.toLowerCase()}</button>
  <input ref={input} className="home-file" type="file" accept="image/png,image/jpeg" tabIndex={-1} aria-hidden="true" onChange={e=>{upload(e.target.files?.[0]);e.target.value=''}}/>
  {id&&<button type="button" className="button secondary small" onClick={()=>onChange('')}><Trash2 size={15}/>Remove {label.toLowerCase()}</button>}
  {id&&onPosition&&<label className="home-position">Keep in view<select value={position} onChange={e=>onPosition(e.target.value)}>{POSITIONS.map(p=><option key={p} value={p}>{title(p)}</option>)}</select></label>}</div></div>
  {hint&&<small className="home-hint">{hint}</small>}{error&&<ErrorBox message={error}/>}</div>
}
// Several photographs at once, for the gallery. Each file is checked and stored exactly like a single upload.
function ManyImages({room,onAdd}:{room:number,onAdd:(ids:string[])=>void}){
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),input=useRef<HTMLInputElement>(null)
 async function upload(files:File[]){
  const chosen=files.slice(0,room),ids:string[]=[],problems:string[]=files.length>room?['Only '+room+' more photographs fit in the gallery.']:[]
  for(const [i,file] of chosen.entries()){const problem=imageProblem(file);if(problem){problems.push(file.name+': '+problem);continue}
   setBusy('Uploading '+(i+1)+' of '+chosen.length+'…');try{ids.push(await sendImage(file))}catch(e){problems.push(file.name+': '+errorMessage(e))}}
  setBusy('');setError(problems.join(' '));if(ids.length)onAdd(ids)
 }
 return <div className="home-image-field"><button type="button" className="button secondary" disabled={!!busy||room<=0} onClick={()=>input.current?.click()}><Upload size={16}/>{busy||'Upload photographs'}</button>
  <input ref={input} className="home-file" type="file" accept="image/png,image/jpeg" multiple tabIndex={-1} aria-hidden="true" onChange={e=>{upload([...(e.target.files||[])]);e.target.value=''}}/>
  <small className="home-hint">Choose several at once. PNG or JPEG, up to 5 MB each. The first photograph is shown largest.</small>{error&&<ErrorBox message={error}/>}</div>
}
// Changes are described as a function of the current list, so the page applies them to the latest draft.
function Items<T>({items,onChange,blank,max,add,name,children}:{items:T[],onChange:(change:(items:T[])=>T[])=>void,blank:T,max:number,add:string,name:(item:T,index:number)=>string,children:(item:T,update:(patch:Partial<T>)=>void,index:number)=>ReactNode}){
 return <div className="home-items">{items.map((item,i)=>{const label=name(item,i);return <fieldset key={i} className="home-item"><legend>{label}</legend>
  <div className="home-item-actions"><button type="button" className="icon-button" aria-label={'Move '+label+' up'} disabled={i===0} onClick={()=>onChange(list=>move(list,i,-1))}><ArrowUp size={16}/></button><button type="button" className="icon-button" aria-label={'Move '+label+' down'} disabled={i===items.length-1} onClick={()=>onChange(list=>move(list,i,1))}><ArrowDown size={16}/></button><button type="button" className="icon-button" aria-label={'Remove '+label} onClick={()=>onChange(list=>list.filter((_,n)=>n!==i))}><Trash2 size={16}/></button></div>
  {children(item,patch=>onChange(list=>list.map((x,n)=>n===i?{...x,...patch}:x)),i)}</fieldset>})}
  <button type="button" className="button secondary" disabled={items.length>=max} onClick={()=>onChange(list=>[...list,blank])}><Plus size={16}/>{add}</button></div>
}
function Shown({value,onChange,label}:{value:number,onChange:(count:number)=>void,label:string}){
 return <label>{label}<select value={value} onChange={e=>onChange(Number(e.target.value))}>{[1,2,3,4,5,6,7,8,9,10].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
}
type Patch=Partial<Draft>|((draft:Draft)=>Partial<Draft>)
function Editor({section,draft,set,teachers}:{section:SectionKey,draft:Draft,set:(patch:Patch)=>void,teachers:Manage['teachers']}){
 const {hero,identity,principal,results}=draft,brand=draft.brand||{primary:'',accent:''},theme=brandTheme(brand)
 switch(section){
  case 'hero':return <><Note>This is the first thing your school sees: your photograph, logo and colours, with the school name from School settings.</Note>
   <ImageField label="Banner image" id={hero.bannerId} position={hero.bannerPosition} hint="A wide photograph of your campus or students works best; it fills the top of the page. PNG or JPEG, up to 5 MB." onChange={bannerId=>set(d=>({hero:{...d.hero,bannerId}}))} onPosition={bannerPosition=>set({hero:{...hero,bannerPosition}})}/>
   <ImageField label="School logo" id={hero.logoId} hint="Shown on the banner, in the header and in the footer." onChange={logoId=>set(d=>({hero:{...d.hero,logoId}}))}/>
   <Field label="Tagline (optional)" value={hero.tagline} max={160} placeholder="A short line that describes your school" onChange={tagline=>set({hero:{...hero,tagline}})}/>
   <Field label="Motto (optional)" value={identity.motto} max={200} placeholder="Learn. Grow. Lead." onChange={motto=>set({identity:{...identity,motto}})}/>
   <div className="home-colours"><label>Primary colour<input type="color" value={brand.primary||DEFAULT_BRAND.primary} onChange={e=>set({brand:{...brand,primary:e.target.value}})}/></label><label>Accent colour<input type="color" value={brand.accent||DEFAULT_BRAND.accent} onChange={e=>set({brand:{...brand,accent:e.target.value}})}/></label>
    <button type="button" className="button secondary small" disabled={!brand.primary&&!brand.accent} onClick={()=>set({brand:{primary:'',accent:''}})}>Use EduOS colours</button></div>
   <div className="home-swatches" aria-hidden="true">On the page:{['--sw-deep','--sw-primary','--sw-soft','--sw-tint'].map(shade=><i key={shade} style={{background:theme[shade]}}/>)}<b style={{background:theme['--sw-accent'],color:theme['--sw-on-accent']}}>Enter Dashboard</b></div>
   <Note>Your two school colours shape the banner, buttons, figures and section backgrounds. Lighter and darker shades are worked out for you, and text always stays readable.</Note></>
  case 'identity':return <><Field label="Motto (shown on the banner)" value={identity.motto} max={200} onChange={motto=>set({identity:{...identity,motto}})}/>
   <Field label="Vision" area value={identity.vision} max={1000} onChange={vision=>set({identity:{...identity,vision}})}/>
   <Field label="Mission" area value={identity.mission} max={1000} onChange={mission=>set({identity:{...identity,mission}})}/></>
  case 'principal':return <><div className="form-grid"><Field label="Name" value={principal.name} max={120} placeholder="Uses the principal in School settings when left blank" onChange={name=>set({principal:{...principal,name}})}/>
   <Field label="Designation" value={principal.designation} max={120} placeholder="Principal" onChange={designation=>set({principal:{...principal,designation}})}/></div>
   <Field label="Message" area value={principal.message} max={2000} onChange={message=>set({principal:{...principal,message}})}/>
   <ImageField label="Photo" id={principal.photoId} position={principal.photoPosition} onChange={photoId=>set(d=>({principal:{...d.principal,photoId}}))} onPosition={photoPosition=>set({principal:{...principal,photoPosition}})}/></>
  case 'results':return <><Note>These figures are typed by you. Nothing is read from student records, so name a rank holder only with the family’s consent.</Note>
   <div className="form-grid"><Field label="Academic year" value={results.academicYear} max={20} placeholder="2025-26" onChange={academicYear=>set({results:{...results,academicYear}})}/>
   <Field label="Pass percentage" type="number" value={results.passPercentage} max={6} onChange={passPercentage=>set({results:{...results,passPercentage}})}/>
   <Field label="Distinctions" type="number" value={results.distinctions} max={6} onChange={distinctions=>set({results:{...results,distinctions}})}/></div>
   <Items items={results.toppers} max={10} add="Add a rank (optional)" blank={{rank:'',name:'',detail:''}} name={(t,i)=>t.name||'Rank '+(i+1)} onChange={change=>set(d=>({results:{...d.results,toppers:change(d.results.toppers)}}))}>{(t,update)=><div className="form-grid">
    <Field label="Rank" value={t.rank} max={30} placeholder="1st" onChange={rank=>update({rank})}/><Field label="Name" value={t.name} max={120} onChange={name=>update({name})}/><Field label="Detail (optional)" value={t.detail} max={120} placeholder="98.4% · Class X" onChange={detail=>update({detail})}/></div>}</Items></>
  case 'statistics':return <><Note>Live counts come from your school’s own records. Use your own value for anything else, such as years established.</Note>
   <Items items={draft.statistics.items} max={8} add="Add a statistic" blank={{label:'',source:'custom',value:''}} name={(s,i)=>s.label||'Statistic '+(i+1)} onChange={change=>set(d=>({statistics:{items:change(d.statistics.items)}}))}>{(s,update)=><div className="form-grid">
    <Field label="Label" value={s.label} max={40} placeholder="Years of excellence" onChange={label=>update({label})}/>
    <label>Value from<select value={s.source} onChange={e=>update({source:e.target.value})}>{STAT_SOURCES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    {s.source==='custom'&&<Field label="Value" value={s.value} max={20} placeholder="25" onChange={value=>update({value})}/>}</div>}</Items></>
  case 'faculty':return <>{teachers.length?<Note>Only the people you add here are shown. Names come from each teacher’s profile.</Note>:<Note>No teacher profiles are available to your account. Add teachers under Teacher profiles first.</Note>}
   <Items items={draft.faculty.items} max={24} add="Add a featured person" blank={{teacherId:'',designation:'',description:'',photoId:'',photoPosition:'center',visible:true}} name={(f,i)=>teachers.find(t=>t.id===f.teacherId)?.label||'Featured person '+(i+1)} onChange={change=>set(d=>({faculty:{items:change(d.faculty.items)}}))}>{(f,update)=><>
    <div className="form-grid"><label>Teacher<select value={f.teacherId} onChange={e=>update({teacherId:e.target.value})}><option value="">Choose a teacher…</option>{teachers.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
    <Field label="Designation (optional)" value={f.designation} max={120} placeholder="Head of Science" onChange={designation=>update({designation})}/></div>
    <Field label="Short description" area value={f.description} max={400} onChange={description=>update({description})}/>
    <ImageField label="Photo" id={f.photoId} position={f.photoPosition} onChange={photoId=>update({photoId})} onPosition={photoPosition=>update({photoPosition})}/>
    <label className="home-check"><input type="checkbox" checked={f.visible} onChange={e=>update({visible:e.target.checked})}/>Show on School Home</label></>}</Items></>
  case 'achievements':return <Items items={draft.achievements.items} max={24} add="Add an achievement" blank={{title:'',description:'',category:'Academic',imageId:''}} name={(a,i)=>a.title||'Achievement '+(i+1)} onChange={change=>set(d=>({achievements:{items:change(d.achievements.items)}}))}>{(a,update)=><>
    <div className="form-grid"><Field label="Title" value={a.title} max={120} onChange={title=>update({title})}/><label>Category<select value={a.category} onChange={e=>update({category:e.target.value})}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></label></div>
    <Field label="Description" area value={a.description} max={600} onChange={description=>update({description})}/>
    <ImageField label="Image" id={a.imageId} onChange={imageId=>update({imageId})}/></>}</Items>
  case 'events':return <><Note>Upcoming dates are taken from the <Link to="/suite/calendar">School calendar</Link>, so there is nothing to enter twice. People see this section only if their role can open the calendar.</Note>
   <Shown label="Events shown" value={draft.events.count} onChange={count=>set({events:{count}})}/></>
  case 'announcements':return <><Note>The latest <Link to="/suite/circulars">Circulars</Link> are shown. Each person sees only the circulars addressed to them.</Note>
   <Shown label="Announcements shown" value={draft.announcements.count} onChange={count=>set({announcements:{count}})}/></>
  case 'gallery':return <><ManyImages room={30-draft.gallery.items.length} onAdd={ids=>set(current=>({gallery:{items:[...current.gallery.items,...ids.map(imageId=>({imageId,caption:''}))]}}))}/>
   <Items items={draft.gallery.items} max={30} add="Add a photograph" blank={{imageId:'',caption:''}} name={(g,i)=>g.caption||'Photograph '+(i+1)} onChange={change=>set(d=>({gallery:{items:change(d.gallery.items)}}))}>{(g,update)=><>
    <ImageField label="Photograph" id={g.imageId} onChange={imageId=>update({imageId})}/><Field label="Caption (optional)" value={g.caption} max={120} onChange={caption=>update({caption})}/></>}</Items></>
 }
}
export default function SchoolHomeManagePage(){
 const cache=useQueryClient(),navigate=useNavigate()
 const manage=useQuery<Manage>({queryKey:['school-home-manage'],gcTime:0,queryFn:async()=>(await client.get('/suite/home/manage')).data.data})
 const [draft,setDraft]=useState<Draft|null>(null),[state,setState]=useState<State|null>(null),[selected,setSelected]=useState<SectionKey>('hero')
 const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
 useEffect(()=>{if(manage.data&&!draft){setDraft(manage.data.draft);setState(manage.data)}},[manage.data])
 if(manage.isError)return <><PageHeader eyebrow="SCHOOL CONFIGURATION" title="School Home" description="The welcome page your school community sees after signing in."/><ErrorBox message={errorMessage(manage.error)}/></>
 if(!draft||!state)return <Loading/>
 const set=(patch:Patch)=>{setDraft(current=>current&&{...current,...(typeof patch==='function'?patch(current):patch)});setDirty(true);setMessage('')}
 // Every action stores the draft first, so the preview and the published page always match what is on screen.
 // Preview then opens the standalone page itself, drawn from that saved draft.
 async function submit(action:'save'|'publish'|'unpublish',thenPreview=false){
  setBusy(true);setError('');setMessage('')
  try{const saved=(await client.put('/suite/home',{draft,version:state!.version,action})).data.data
   setDraft(saved.draft);setState(saved);setDirty(false);await cache.invalidateQueries({queryKey:['school-home']})
   if(thenPreview)navigate('/home/preview')
   else{setMessage(action==='publish'?'School Home is published. Your school community sees it after signing in.':action==='unpublish'?'School Home is no longer shown after sign-in. Your draft is kept.':'Draft saved. Publish it when you are ready.')}
  }catch(e){setError(errorMessage(e))}finally{setBusy(false)}
 }
 const status=!state.published?'Not published':dirty||state.pending?'Published · changes not yet published':'Published'
 const publish=<button className="button primary" disabled={busy} onClick={()=>submit('publish')}><Send size={16}/>{state.published?'Publish changes':'Publish'}</button>
 const current=draft.sections.find(s=>s.key===selected)!
 return <><PageHeader eyebrow="SCHOOL CONFIGURATION" title="School Home" description="The welcome page your school community sees after signing in.">
  <button className="button secondary" disabled={busy} onClick={()=>submit('save',true)}><Eye size={16}/>Preview</button><button className="button secondary" disabled={busy} onClick={()=>submit('save')}><Save size={16}/>Save draft</button>{publish}</PageHeader>
 {error&&<ErrorBox message={error}/>}{message&&<div className="success-box" role="status">{message}</div>}
 <div className="home-manage"><section className="panel" aria-label="Sections"><div className="panel-heading"><div><h2>Sections</h2><p>Choose what appears, and in what order</p></div></div>
  <ol className="home-section-list">{draft.sections.map((s,i)=>{const label=SECTION_LABELS[s.key];return <li key={s.key} className={s.key===selected?'active':''}>
   <button type="button" className="home-section-name" aria-current={s.key===selected?'true':undefined} onClick={()=>setSelected(s.key)}><span>{label}</span><small>{s.visible?'Shown':'Hidden'}</small></button>
   <button type="button" className="icon-button" aria-label={(s.visible?'Hide ':'Show ')+label} aria-pressed={s.visible} onClick={()=>set({sections:draft.sections.map(x=>x.key===s.key?{...x,visible:!x.visible}:x)})}>{s.visible?<Eye size={16}/>:<EyeOff size={16}/>}</button>
   <button type="button" className="icon-button" aria-label={'Move '+label+' up'} disabled={i===0} onClick={()=>set({sections:move(draft.sections,i,-1)})}><ArrowUp size={16}/></button>
   <button type="button" className="icon-button" aria-label={'Move '+label+' down'} disabled={i===draft.sections.length-1} onClick={()=>set({sections:move(draft.sections,i,1)})}><ArrowDown size={16}/></button></li>})}</ol>
  <div className="home-status"><span className={'status-tag '+(state.published?'active':'')}>{status}</span>{state.publishedAt&&<small>Last published {new Date(state.publishedAt).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</small>}{dirty&&<small>You have unsaved changes.</small>}
   {state.published&&<button type="button" className="button secondary small" disabled={busy} onClick={()=>submit('unpublish')}>Unpublish</button>}</div></section>
  <section className="panel" aria-label={SECTION_LABELS[selected]}><div className="panel-heading"><div><h2>{SECTION_LABELS[selected]}</h2><p>{SECTION_HINTS[selected]}</p></div><span className={'status-tag '+(current.visible?'active':'')}>{current.visible?'Shown':'Hidden'}</span></div>
   <div className="home-editor"><Editor section={selected} draft={draft} set={set} teachers={manage.data?.teachers||[]}/></div></section></div></>
}
