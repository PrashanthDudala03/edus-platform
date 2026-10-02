import { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, GraduationCap, Megaphone } from 'lucide-react'
import client from '../../api/client'
import { eventDates, figure, type HomeView, type SectionKey } from './schoolHome'
type Row=Record<string,any>
// Images need the signed-in session, so they are fetched through the API client rather than a plain image address.
export function HomeImage({id,alt,className,position}:{id:string,alt:string,className?:string,position?:string}){
 const image=useQuery({queryKey:['school-home-image',id],staleTime:Infinity,gcTime:Infinity,retry:false,queryFn:async()=>URL.createObjectURL((await client.get('/suite/home/images/'+id,{responseType:'blob'})).data as Blob)})
 return image.data?<img className={className} src={image.data} alt={alt} style={{objectPosition:position||'center'}}/>:<span className={(className||'')+' home-image-loading'} role={alt?'img':undefined} aria-label={alt||undefined}/>
}
function Block({kicker,title,link,children}:{kicker:string,title:string,link?:ReactNode,children:ReactNode}){
 return <section className="sh-section"><div className="sh-wrap"><div className="sh-head"><div><p className="sh-kicker">{kicker}</p><h2>{title}</h2></div>{link}</div>{children}</div></section>
}
// The school's identity (banner, logo, name, tagline, motto) is drawn by the page header; every other section is drawn here, in the school's order.
function Section({name,section,c}:{name:string,section:SectionKey,c:Row}){
 const items:Row[]=c.items||[]
 switch(section){
  case 'hero':return null
  case 'identity':return c.vision||c.mission?<Block kicker="Who we are" title="Vision & mission"><div className="sh-pair">{[['Our vision',c.vision],['Our mission',c.mission]].filter(([,text])=>text).map(([title,text])=><article key={title}><h3>{title}</h3><p>{text}</p></article>)}</div></Block>:null
  case 'principal':return <Block kicker="Leadership" title="From the Principal"><div className={'sh-principal'+(c.photoId?'':' no-photo')}>{c.photoId&&<HomeImage id={c.photoId} alt={c.name||'Principal'} className="sh-portrait" position={c.photoPosition}/>}
   <div>{c.message&&<blockquote>{c.message}</blockquote>}{(c.name||c.designation)&&<div className="sh-sign">{c.name&&<strong>{c.name}</strong>}{c.designation&&<span>{c.designation}</span>}</div>}</div></div></Block>
  case 'results':return <Block kicker="Academic results" title={c.academicYear?'Results · '+c.academicYear:'Previous academic year'}>
   {(c.passPercentage||c.distinctions)&&<div className="sh-figures">{c.passPercentage&&<div><strong>{c.passPercentage}%</strong><span>Pass percentage</span></div>}{c.distinctions&&<div><strong>{figure(c.distinctions)}</strong><span>Distinctions</span></div>}</div>}
   {c.toppers?.length>0&&<ol className="sh-toppers">{c.toppers.map((t:Row,i:number)=><li key={i}><span className="sh-rank">{t.rank||'Rank '+(i+1)}</span><div><strong>{t.name}</strong>{t.detail&&<small>{t.detail}</small>}</div></li>)}</ol>}</Block>
  case 'statistics':return <section className="sh-stats" aria-label="School statistics"><div className="sh-wrap sh-stats-grid">{items.map((s,i)=><div key={i}><strong>{figure(s.value)}</strong><span>{s.label}</span></div>)}</div></section>
  case 'faculty':return <Block kicker="Our people" title="Featured faculty"><div className="sh-people">{items.map((f,i)=><article key={i}>{f.photoId?<HomeImage id={f.photoId} alt="" className="sh-person-photo" position={f.photoPosition}/>:<span className="sh-person-initial" aria-hidden="true">{String(f.name).slice(0,1).toUpperCase()}</span>}
   <div><h3>{f.name}</h3>{(f.designation||f.department)&&<small>{[f.designation,f.department].filter(Boolean).join(' · ')}</small>}{f.description&&<p>{f.description}</p>}</div></article>)}</div></Block>
  case 'achievements':return <Block kicker="Achievements" title="Moments we are proud of"><div className="sh-cards">{items.map((a,i)=><article key={i}>{a.imageId&&<HomeImage id={a.imageId} alt="" className="sh-card-image"/>}<div><span className="tag">{a.category}</span><h3>{a.title}</h3>{a.description&&<p>{a.description}</p>}</div></article>)}</div></Block>
  case 'events':return items.length?<Block kicker="School calendar" title="Upcoming events" link={<Link className="text-link" to="/suite/calendar">Open the school calendar <ArrowUpRight size={15}/></Link>}>
   <ul className="sh-list">{items.map((e,i)=><li key={i}><span className="sh-date" aria-hidden="true"><strong>{new Date(e.startsOn+'T00:00:00').getDate()}</strong><small>{new Date(e.startsOn+'T00:00:00').toLocaleDateString('en-IN',{month:'short'})}</small></span><div><h3>{e.title}</h3><small>{eventDates(e.startsOn,e.endsOn)}</small>{e.description&&<p>{e.description}</p>}</div></li>)}</ul></Block>:null
  case 'announcements':return items.length?<Block kicker="Notices" title="Announcements" link={<Link className="text-link" to="/suite/circulars">View all circulars <ArrowUpRight size={15}/></Link>}>
   <ul className="sh-list">{items.map((n,i)=><li key={i}><span className="notice-icon teal" aria-hidden="true"><Megaphone size={20}/></span><div><h3>{n.title}</h3><small>{new Date(n.createdAt).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</small><p>{String(n.message).slice(0,220)}{String(n.message).length>220?'…':''}</p></div></li>)}</ul></Block>:null
  case 'gallery':return <Block kicker="Gallery" title={'Life at '+name}><div className="sh-gallery">{items.map((g,i)=><figure key={i}><HomeImage id={g.imageId} alt={g.caption||'School photograph '+(i+1)}/>{g.caption&&<figcaption>{g.caption}</figcaption>}</figure>)}</div></Block>
 }
}
export function SchoolHomeView({home,greeting,actions}:{home:HomeView,greeting?:string,actions?:ReactNode}){
 const part=(key:SectionKey):Row=>home.sections.find(s=>s.key===key)?.content||{}
 const hero=part('hero'),motto=part('identity').motto
 return <div className="sh-view"><section className={'sh-hero'+(hero.bannerId?'':' plain')} aria-label={home.schoolName}>
  {hero.bannerId&&<><HomeImage id={hero.bannerId} alt="" className="sh-hero-image" position={hero.bannerPosition}/><div className="sh-hero-shade"/></>}
  <div className="sh-wrap sh-hero-content">{hero.logoId?<HomeImage id={hero.logoId} alt={home.schoolName+' logo'} className="sh-logo"/>:<span className="sh-logo sh-logo-fallback" aria-hidden="true"><GraduationCap size={46}/></span>}
   <div className="sh-hero-text">{greeting&&<p className="sh-kicker">{greeting}</p>}<h1>{home.schoolName}</h1>{hero.tagline&&<p className="sh-tagline">{hero.tagline}</p>}
    {motto&&<div className="sh-motto"><small>Our motto</small><p>{motto}</p></div>}{actions&&<div className="sh-hero-actions">{actions}</div>}</div></div></section>
  {home.sections.map(s=><Section key={s.key} name={home.schoolName} section={s.key} c={s.content}/>)}</div>
}
