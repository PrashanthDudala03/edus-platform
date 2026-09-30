import { ReactNode, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { GraduationCap, LogOut, Menu, X, ArrowUpRight, ShieldCheck } from 'lucide-react'
import { useAuthStore } from '../store/auth'
import { canVisit } from '../access'
import { authAPI } from '../api/auth'
import client from '../api/client'
import { homeFor, isLeadership, navigation, portalName, roleOf, type Role } from '../roles'
export function Shell({children}:{children:ReactNode}) {
 const [open,setOpen]=useState(false),[menuSearch,setMenuSearch]=useState("")
 const {user,refreshToken,clearAuth}=useAuthStore()
 const role=roleOf(user) as Role,home=homeFor(role,user?.dataScope),platform=user?.dataScope==='platform'
 const seen=new Set<string>()
 const sections=(platform?[...navigation.SuperAdmin,{title:'Governance',links:[['/super-admin/access-control','Access control',ShieldCheck] as const]}]:[...(navigation[role]||[]),...Object.values(navigation).flat(),{title:'Access control',links:[['/control','Access control',ShieldCheck] as const]}]).map(s=>({...s,links:s.links.filter(([path])=>{if(seen.has(path)||!canVisit(user,path)||(['/admin','/principal','/teacher','/parent','/student'].includes(path)&&path!==home))return false;seen.add(path);return true})})).filter(s=>s.links.length)
 const cache=useQueryClient(),navigate=useNavigate(),location=useLocation()
 const school=useQuery({queryKey:['school',user?.schoolId,role],enabled:!platform,queryFn:async()=>(await client.get(isLeadership(role)?'/schools/'+user?.schoolId:'/suite/school')).data.data})
 const links=sections.flatMap(s=>s.links)
 const active=links.find(([path])=>path===location.pathname)?.[1] || 'Workspace'
 const logout=async()=>{try{await authAPI.logout(refreshToken)}catch{}finally{clearAuth();cache.clear();navigate('/login')}}
 const term=menuSearch.toLowerCase()
 return <div className="app-shell"><a className="skip-link" href="#main">Skip to content</a>
 {open && <button aria-label="Close navigation" className="nav-overlay" onClick={()=>setOpen(false)} />}
 <aside className={'sidebar '+(open?'is-open':'')}><NavLink to={home} className="brand" onClick={()=>setOpen(false)}><span className="brand-mark"><GraduationCap size={25}/></span><span>edu<span className="brand-light">os</span><small>{(portalName[role]||'School workspace').toUpperCase()}</small></span></NavLink>
 <button className="mobile-close icon-button" aria-label="Close navigation" onClick={()=>setOpen(false)}><X size={20}/></button><div className="workspace-label">YOUR WORKSPACE</div>
 <label className="nav-search">Find a feature<input type="search" value={menuSearch} onChange={e=>setMenuSearch(e.target.value)} placeholder="Search menu..."/></label><nav aria-label="Main navigation">{sections.map(section=>{const visible=section.links.filter(([,label])=>label.toLowerCase().includes(term));return visible.length?<div className="nav-section" key={section.title}><div className="nav-section-title">{section.title}</div>{visible.map(([path,label,Icon])=><NavLink key={path} to={path} end={path===home||path==='/suite'} onClick={()=>setOpen(false)} className={({isActive})=>'nav-link '+(isActive?'active ':'')}><Icon size={19}/><span>{label}</span></NavLink>)}</div>:null})}</nav>
 <div className="sidebar-bottom"><div className="school-card"><span className="school-icon"><GraduationCap size={20}/></span><strong>{platform?'EduOS platform':school.data?.name || 'School workspace'}</strong><small>One school. One connected team.</small><NavLink to={role==='Administrator'?"/settings":home}>{role==='Administrator'?"Manage school":"My dashboard"} <ArrowUpRight size={14}/></NavLink></div><button className="sign-out" onClick={logout}><LogOut size={17}/>Sign out</button></div></aside>
 <div className="workspace"><header className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-button" aria-label="Open navigation" onClick={()=>setOpen(true)}><Menu size={21}/></button><span>{portalName[role]||'Workspace'}</span><span className="slash">/</span><strong>{active}</strong></div><div className="topbar-right"><span className="date-pill">{new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'})}</span><span className="topbar-separator"/><div className="user-info"><strong>{user?.firstName || user?.username}</strong><small>{user?.roles?.join(' · ') || 'Staff'}</small></div><span className="avatar">{(user?.firstName || user?.username || 'A').slice(0,1).toUpperCase()}</span></div></header>
 <main id="main" className="main-content">{children}</main><footer className="workspace-footer"><span>EduOS · School administration, thoughtfully connected.</span><span>Workspace v1.0</span></footer></div></div>
}
