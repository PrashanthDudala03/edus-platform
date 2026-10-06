import { ReactNode, useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { GraduationCap, LogOut, Menu, X, ArrowUpRight, ShieldCheck, UserRound } from 'lucide-react'
import { useAuthStore } from '../store/auth'
import { canVisit } from '../access'
import { authAPI } from '../api/auth'
import client from '../api/client'
import { homeFor, isLeadership, navigation, portalName, roleOf, type Role } from '../roles'
import { AskEduOSAI } from '../ai/AskEduOSAI'
import { accountInitials, accountKind, accountName, accountPath } from '../pages/account'
import { NotificationBell } from '../pages/notifications/NotificationInboxPage'
/** Signs the person out everywhere this browser knows about them: server session, stored session and cached data. */
export function useSignOut(){
 const {refreshToken,clearAuth}=useAuthStore(),cache=useQueryClient(),navigate=useNavigate()
 return async()=>{try{await authAPI.logout(refreshToken)}catch{}finally{clearAuth();cache.clear();navigate('/login')}}
}
// On a phone a table row is shown as a compact card (see index.css). Each cell then needs its column's name, which
// is copied from the table's own header here, once, for every table on every page, as rows arrive. The card layout
// changes the elements' display, which makes browsers drop a table's implicit roles, so the roles are set explicitly
// here too: a screen reader still hears a table with headers and cells whatever the screen width.
const ROLES:[string,string][]=[['table','table'],['thead','rowgroup'],['tbody','rowgroup'],['tr','row'],['th','columnheader'],['td','cell']]
function useLabelledTables(){
 useEffect(()=>{
  const main=document.getElementById('main');if(!main)return
  const label=()=>{for(const table of main.querySelectorAll('table')){const heads=[...table.querySelectorAll('thead th')].map(th=>th.textContent?.trim()||'')
   for(const [tag,role] of ROLES)for(const el of tag==='table'?[table]:table.querySelectorAll(tag))if(!el.hasAttribute('role'))el.setAttribute('role',role)
   for(const row of table.querySelectorAll('tbody tr'))[...row.children].forEach((cell,i)=>{const text=heads[i]||'';if(cell.getAttribute('data-label')!==text)cell.setAttribute('data-label',text)})}}
  let queued=0;const observer=new MutationObserver(()=>{if(!queued)queued=requestAnimationFrame(()=>{queued=0;label()})})
  observer.observe(main,{childList:true,subtree:true});label()
  return()=>{observer.disconnect();cancelAnimationFrame(queued)}
 },[])
}
export function Shell({children}:{children:ReactNode}) {
 const [open,setOpen]=useState(false),[menuSearch,setMenuSearch]=useState("")
 const {user}=useAuthStore(),logout=useSignOut()
 useLabelledTables()
 const role=roleOf(user) as Role,home=homeFor(role,user?.dataScope),platform=user?.dataScope==='platform'
 const seen=new Set<string>()
 const sections=(platform?[...navigation.SuperAdmin,{title:'Governance',links:[['/super-admin/access-control','Access control',ShieldCheck] as const]}]:[...(navigation[role]||[]),...Object.values(navigation).flat(),{title:'Access control',links:[['/control','Access control',ShieldCheck] as const]}]).map(s=>({...s,links:s.links.filter(([path])=>{if(seen.has(path)||!canVisit(user,path)||(['/admin','/principal','/teacher','/parent','/student'].includes(path)&&path!==home))return false;seen.add(path);return true})})).filter(s=>s.links.length)
 const location=useLocation()
 // The profile card under the header identity. It closes on a second click, a click anywhere else, Escape, or a page change.
 const [card,setCard]=useState(false),identity=useRef<HTMLDivElement>(null)
 useEffect(()=>setCard(false),[location.pathname])
 useEffect(()=>{
  if(!card)return
  const outside=(e:PointerEvent)=>{if(!identity.current?.contains(e.target as Node))setCard(false)}
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setCard(false);identity.current?.querySelector('button')?.focus()}}
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape)
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}
 },[card])
 const school=useQuery({queryKey:['school',user?.schoolId,role],enabled:!platform,queryFn:async()=>(await client.get(isLeadership(role)?'/schools/'+user?.schoolId:'/suite/school')).data.data})
 const links=sections.flatMap(s=>s.links)
 const active=links.find(([path])=>path===location.pathname)?.[1] || (location.pathname===accountPath(user)?'My account':'Workspace')
 const term=menuSearch.toLowerCase()
 return <div className="app-shell"><a className="skip-link" href="#main">Skip to content</a>
 {open && <button aria-label="Close navigation" className="nav-overlay" onClick={()=>setOpen(false)} />}
 <aside className={'sidebar '+(open?'is-open':'')}><NavLink to={home} className="brand" onClick={()=>setOpen(false)}><span className="brand-mark"><GraduationCap size={25}/></span><span>edu<span className="brand-light">os</span><small>{(portalName[role]||'School workspace').toUpperCase()}</small></span></NavLink>
 <button className="mobile-close icon-button" aria-label="Close navigation" onClick={()=>setOpen(false)}><X size={20}/></button><div className="workspace-label">YOUR WORKSPACE</div>
 <label className="nav-search">Find a feature<input type="search" value={menuSearch} onChange={e=>setMenuSearch(e.target.value)} placeholder="Search menu..."/></label><nav aria-label="Main navigation">{sections.map(section=>{const visible=section.links.filter(([,label])=>label.toLowerCase().includes(term));return visible.length?<div className="nav-section" key={section.title}><div className="nav-section-title">{section.title}</div>{visible.map(([path,label,Icon])=><NavLink key={path} to={path} end={path===home||path==='/suite'||path==='/home'} onClick={()=>setOpen(false)} className={({isActive})=>'nav-link '+(isActive?'active ':'')}><Icon size={19}/><span>{label}</span></NavLink>)}</div>:null})}</nav>
 <div className="sidebar-bottom"><div className="school-card"><span className="school-icon"><GraduationCap size={20}/></span><strong>{platform?'EduOS platform':school.data?.name || 'School workspace'}</strong><small>One school. One connected team.</small><NavLink to={role==='Administrator'?"/settings":home}>{role==='Administrator'?"Manage school":"My dashboard"} <ArrowUpRight size={14}/></NavLink></div><button className="sign-out" onClick={logout}><LogOut size={17}/>Sign out</button></div></aside>
 <div className="workspace"><header className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-button" aria-label="Open navigation" onClick={()=>setOpen(true)}><Menu size={21}/></button><span>{portalName[role]||'Workspace'}</span><span className="slash">/</span><strong>{active}</strong></div><div className="topbar-right">{!platform&&<NotificationBell/>}<span className="date-pill">{new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'})}</span><span className="topbar-separator"/><div className="identity-wrap" ref={identity}><button type="button" className={'identity'+(card?' active':'')} aria-haspopup="dialog" aria-expanded={card} aria-controls="profile-card" aria-label={'My account: '+accountName(user)+', '+accountKind(user)} title="My account" onClick={()=>setCard(!card)}><span className="user-info"><strong>{user?.firstName || user?.username}</strong><small>{user?.roles?.join(' · ') || 'Staff'}</small></span><span className="avatar" aria-hidden="true">{(user?.firstName || user?.username || 'A').slice(0,1).toUpperCase()}</span></button>
 {card&&<div id="profile-card" className="profile-card" role="dialog" aria-label="My account"><div className="profile-card-top"><span className="avatar" aria-hidden="true">{accountInitials(user)}</span><div><strong>{accountName(user)}</strong><small>{accountKind(user)}</small></div></div>
  <dl><div><dt>{platform?'Workspace':'School'}</dt><dd>{platform?'EduOS platform':school.data?.name||'School workspace'}</dd></div><div><dt>Sign-in name</dt><dd>{user?.username}</dd></div>{!!user?.email&&user.email!==user.username&&<div><dt>Email</dt><dd>{user.email}</dd></div>}</dl>
  <div className="profile-card-actions"><NavLink to={accountPath(user)} className="button secondary" onClick={()=>setCard(false)}><UserRound size={16}/>View profile</NavLink><button type="button" className="button secondary" onClick={logout}><LogOut size={16}/>Sign out</button></div></div>}</div></div></header>
 <main id="main" className="main-content">{children}</main><footer className="workspace-footer"><span>EduOS · School administration, thoughtfully connected.</span><span>Workspace v1.0</span></footer></div><AskEduOSAI/></div>
}
