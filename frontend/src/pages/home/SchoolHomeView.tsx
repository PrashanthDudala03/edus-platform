import { CSSProperties, ReactNode, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, ArrowUpRight, ChevronDown, Eye, GraduationCap, LogOut, Pencil, Quote } from 'lucide-react'
import client from '../../api/client'
import { brandTheme, eventDates, figure, greeting, initials, type HomeView, type SectionKey } from './schoolHome'
type Row=Record<string,any>
// Images need the signed-in session, so they are fetched through the API client rather than a plain image address.
// The page's content security policy allows data: images but not blob: ones, so the bytes are handed to the browser as a data address.
const asDataUrl=(blob:Blob)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob)})
export function HomeImage({id,alt,className,position}:{id:string,alt:string,className?:string,position?:string}){
 const image=useQuery({queryKey:['school-home-image',id],staleTime:Infinity,gcTime:Infinity,retry:false,queryFn:async()=>asDataUrl((await client.get('/suite/home/images/'+id,{responseType:'blob'})).data as Blob)})
 return image.data?<img className={className} src={image.data} alt={alt} style={{objectPosition:position||'center'}}/>:<span className={(className||'')+' home-image-loading'} role={alt?'img':undefined} aria-label={alt||undefined}/>
}
// Sections ease into view once as the reader reaches them. Nothing moves for people who ask for reduced motion.
function useReveal(key:unknown){
 const root=useRef<HTMLDivElement>(null)
 useEffect(()=>{const page=root.current
  if(!page||!('IntersectionObserver' in window)||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return
  const watcher=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-in');watcher.unobserve(entry.target)}}),{rootMargin:'0px 0px -6% 0px',threshold:0.06})
  page.classList.add('sw-motion');page.querySelectorAll('[data-reveal]').forEach(item=>watcher.observe(item))
  return()=>{watcher.disconnect();page.classList.remove('sw-motion')}},[key])
 return root
}
function Head({kicker,title,link}:{kicker:string,title:string,link?:ReactNode}){return <div className="sw-head"><div><p className="sw-kicker">{kicker}</p><h2>{title}</h2></div>{link}</div>}
const shortDate=(value:string)=>new Date(value).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})
function Events({items}:{items:Row[]}){
 return <div><Head kicker="School calendar" title="Upcoming events" link={<Link className="sw-more" to="/suite/calendar">Open the calendar <ArrowUpRight size={15}/></Link>}/>
  <ul className="sw-events">{items.map((e,i)=><li key={i}><span className="sw-date" aria-hidden="true"><strong>{new Date(e.startsOn+'T00:00:00').getDate()}</strong><small>{new Date(e.startsOn+'T00:00:00').toLocaleDateString('en-IN',{month:'short'})}</small></span><div><h3>{e.title}</h3><small>{eventDates(e.startsOn,e.endsOn)}</small>{e.description&&<p>{e.description}</p>}</div></li>)}</ul></div>
}
function Notices({items}:{items:Row[]}){
 return <div><Head kicker="Notices" title="Announcements" link={<Link className="sw-more" to="/suite/circulars">View all circulars <ArrowUpRight size={15}/></Link>}/>
  <ul className="sw-notices">{items.map((n,i)=><li key={i}><small>{shortDate(n.createdAt)}</small><h3>{n.title}</h3><p>{String(n.message).slice(0,220)}{String(n.message).length>220?'…':''}</p></li>)}</ul></div>
}
// Each section has its own composition; the hero (banner, logo, name, tagline, motto) is drawn by SchoolWelcome itself.
function Section({name,section,c,pair,lift}:{name:string,section:SectionKey,c:Row,pair?:Row,lift?:boolean}){
 const items:Row[]=c.items||[]
 switch(section){
  case 'statistics':return <section className={'sw-glance'+(lift?' lift':'')} aria-label="School at a glance"><div className="sw-wrap"><div className="sw-glance-card" data-reveal>{items.map((s,i)=><div key={i}><strong>{figure(s.value)}</strong><span>{s.label}</span></div>)}</div></div></section>
  case 'identity':return <section className="sw-section"><div className="sw-wrap" data-reveal><Head kicker="Our purpose" title={c.vision&&c.mission?'Vision & mission':c.vision?'Our vision':'Our mission'}/>
   <div className="sw-pair">{[['Vision',c.vision],['Mission',c.mission]].filter(([,text])=>text).map(([title,text])=><article key={title}><h3>{title}</h3><p>{text}</p></article>)}</div></div></section>
  case 'principal':return <section className="sw-section sw-tinted"><div className={'sw-wrap sw-principal'+(c.photoId?'':' no-photo')} data-reveal>{c.photoId&&<div className="sw-portrait"><HomeImage id={c.photoId} alt={c.name||'Principal'} position={c.photoPosition}/></div>}
   <div><p className="sw-kicker">From the Principal</p><Quote className="sw-quote" size={46} aria-hidden="true"/>{c.message&&<blockquote className="sw-serif">{c.message}</blockquote>}{(c.name||c.designation)&&<p className="sw-sign"><span>{c.name&&<strong>{c.name}</strong>}{c.designation&&<span>{c.designation}</span>}</span></p>}</div></div></section>
  case 'results':return <section className="sw-section sw-dark"><div className={'sw-wrap sw-results'+(c.toppers?.length?'':' no-ranks')} data-reveal><div><Head kicker="Academic excellence" title={c.academicYear?'Results · '+c.academicYear:'Previous academic year'}/>
   {(c.passPercentage||c.distinctions)&&<div className="sw-figures">{c.passPercentage&&<div><strong>{c.passPercentage}%</strong><span>Pass percentage</span></div>}{c.distinctions&&<div><strong>{figure(c.distinctions)}</strong><span>Distinctions</span></div>}</div>}</div>
   {c.toppers?.length>0&&<ol className="sw-ranks">{c.toppers.map((t:Row,i:number)=><li key={i}><span>{t.rank||i+1}</span><div><strong>{t.name}</strong>{t.detail&&<small>{t.detail}</small>}</div></li>)}</ol>}</div></section>
  case 'faculty':return <section className="sw-section"><div className="sw-wrap" data-reveal><Head kicker="Our people" title="Featured faculty"/><div className="sw-people">{items.map((f,i)=><article key={i}>
   <div className="sw-person-tile">{f.photoId?<HomeImage id={f.photoId} alt="" position={f.photoPosition}/>:<span className="sw-monogram" aria-hidden="true">{initials(f.name,2)}</span>}
    <div className="sw-person-name"><h3>{f.name}</h3>{(f.designation||f.department)&&<small>{[f.designation,f.department].filter(Boolean).join(' · ')}</small>}</div></div>{f.description&&<p>{f.description}</p>}</article>)}</div></div></section>
  case 'achievements':return <section className="sw-section sw-tinted"><div className="sw-wrap" data-reveal><Head kicker="Achievements" title="Moments we are proud of"/><div className="sw-wins">{items.map((a,i)=><article key={i} className={a.imageId?(i===0&&items.length>2?'featured':''):'no-image'}>
   {a.imageId&&<div className="sw-win-media"><HomeImage id={a.imageId} alt=""/><span className="sw-chip">{a.category}</span></div>}<div className="sw-win-text">{!a.imageId&&<span className="sw-chip">{a.category}</span>}<h3>{a.title}</h3>{a.description&&<p>{a.description}</p>}</div></article>)}</div></div></section>
  case 'gallery':return <section className="sw-section"><div className="sw-wrap" data-reveal><Head kicker="School gallery" title={'Life at '+name}/><div className={'sw-gallery'+(items.length>2?' mosaic':'')+(items.length===3?' three':'')}>{items.map((g,i)=><figure key={i}><HomeImage id={g.imageId} alt={g.caption||'School photograph '+(i+1)}/>{g.caption&&<figcaption>{g.caption}</figcaption>}</figure>)}</div></div></section>
  case 'events':return <section className="sw-section sw-tinted"><div className={'sw-wrap'+(pair?' sw-news':'')} data-reveal><Events items={items}/>{pair&&<Notices items={pair.items}/>}</div></section>
  case 'announcements':return <section className="sw-section sw-tinted"><div className={'sw-wrap'+(pair?' sw-news':'')} data-reveal>{pair&&<Events items={pair.items}/>}<Notices items={items}/></div></section>
  default:return null
 }
}
type Props={home:HomeView,dashboard:string,firstName?:string,canManage?:boolean,preview?:boolean,onSignOut?:()=>void,children?:ReactNode}
/** The standalone School Welcome page. The published page and the administrator's preview both render exactly this. */
export function SchoolWelcome({home,dashboard,firstName,canManage,preview,onSignOut,children}:Props){
 const part=(key:SectionKey):Row=>home.sections.find(s=>s.key===key)?.content||{}
 const hero=part('hero'),motto=hero.motto??part('identity').motto,name=home.schoolName,root=useReveal(home)
 // Only sections with something to show; events and announcements that sit together share one two-column block.
 const shown=home.sections.filter(s=>s.key==='hero'?false:s.key==='identity'?s.content.vision||s.content.mission:['events','announcements'].includes(s.key)?s.content.items?.length:true)
 const blocks=shown.flatMap((s,i)=>{const news=(key:string)=>['events','announcements'].includes(key),before=shown[i-1],after=shown[i+1]
  if(news(s.key)&&before&&news(before.key))return []
  return [{...s,pair:news(s.key)&&after&&news(after.key)?after.content:undefined}]})
 const glanceFirst=blocks[0]?.key==='statistics'
 const logo=(className:string,alt:string,size:number)=>hero.logoId?<HomeImage id={hero.logoId} alt={alt} className={className}/>:<span className={className+' sw-mark'} aria-hidden="true"><GraduationCap size={size}/></span>
 return <div className="sw" ref={root} style={brandTheme(home.brand) as CSSProperties}><a className="skip-link" href="#main">Skip to content</a>
  {preview&&<div className="sw-preview" role="status"><span><Eye size={16}/>Preview of your saved draft. Your school sees it only after you publish.</span><Link className="button secondary small" to="/home/manage"><ArrowLeft size={15}/>Back to management</Link></div>}
  <header className="sw-bar"><div className="sw-wrap"><span className="sw-id">{logo('sw-id-logo','',20)}<strong>{name}</strong></span>
   <div className="sw-bar-actions">{canManage&&!preview&&<Link className="sw-quiet" to="/home/manage" aria-label="Edit School Home"><Pencil size={14}/><span>Edit School Home</span></Link>}{onSignOut&&<button type="button" className="sw-quiet" onClick={onSignOut} aria-label="Sign out"><LogOut size={14}/><span>Sign out</span></button>}
    <Link className="button sw-cta" to={dashboard} aria-label="Enter Dashboard"><span>Enter<span className="sw-wide"> Dashboard</span></span><ArrowRight size={16}/></Link></div></div></header>
  <main id="main"><section className={'sw-hero'+(hero.bannerId?'':' plain')+(glanceFirst?' with-glance':'')} aria-label={'Welcome to '+name}>
   {hero.bannerId?<><HomeImage id={hero.bannerId} alt="" className="sw-hero-image" position={hero.bannerPosition}/><div className="sw-hero-shade"/></>:<div className="sw-hero-art" aria-hidden="true"><i/><i/>{!hero.logoId&&<span>{initials(name,3)}</span>}</div>}
   <div className="sw-wrap sw-hero-content">{hero.logoId&&logo('sw-hero-logo',name+' logo',0)}{firstName&&<p className="sw-greeting">{greeting(new Date().getHours())}, {firstName}</p>}
    <h1><span>Welcome to</span> {name}</h1>{hero.tagline&&<p className="sw-tagline">{hero.tagline}</p>}{motto&&<p className="sw-motto sw-serif">{motto}</p>}
    <div className="sw-hero-actions"><Link className="button sw-enter" to={dashboard}>Enter Dashboard<ArrowRight size={18}/></Link>{blocks.length>0&&<a className="sw-scroll" href="#school">Discover our school <ChevronDown size={17}/></a>}</div></div></section>
   <div id="school">{blocks.map((s,i)=><Section key={s.key} name={name} section={s.key} c={s.content} pair={s.pair} lift={i===0}/>)}</div>
   <section className="sw-ready"><div className="sw-wrap"><div><h2>Your workspace is ready.</h2>{children}</div><Link className="button sw-enter" to={dashboard}>Enter Dashboard<ArrowRight size={18}/></Link></div></section></main>
  <footer className="sw-foot"><div className="sw-wrap"><div className="sw-foot-id">{logo('sw-foot-logo','',30)}<div><strong>{name}</strong>{(motto||hero.tagline)&&<em className="sw-serif">{motto||hero.tagline}</em>}</div></div><small className="sw-powered">Powered by EduOS</small></div></footer></div>
}
