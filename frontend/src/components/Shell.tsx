import { ReactNode, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LayoutDashboard, GraduationCap, Users, BookOpen, CalendarCheck, Megaphone, ShieldCheck, Settings, LogOut, Menu, X, ArrowUpRight } from 'lucide-react'
import { useAuthStore } from '../store/auth'
import { authAPI } from '../api/auth'
import client from '../api/client'
const links = [
 ['/', 'Overview', LayoutDashboard], ['/students','Students',GraduationCap],['/teachers','Teachers',BookOpen],
 ['/parents','Parents & guardians',Users],['/attendance','Attendance',CalendarCheck],['/announcements','Noticeboard',Megaphone],
 ['/audit','Activity log',ShieldCheck],['/settings','School settings',Settings],
] as const
export function Shell({children}:{children:ReactNode}) {
 const [open,setOpen]=useState(false)
 const {user,refreshToken,clearAuth}=useAuthStore()
 const cache=useQueryClient(),navigate=useNavigate(),location=useLocation()
 const school=useQuery({queryKey:['school',user?.schoolId],queryFn:async()=>(await client.get('/schools/'+user?.schoolId)).data.data})
 const active=links.find(([path])=>path===location.pathname)?.[1] || 'Workspace'
 const logout=async()=>{try{await authAPI.logout(refreshToken)}catch{}finally{clearAuth();cache.clear();navigate('/login')}}
 return <div className="app-shell"><a className="skip-link" href="#main">Skip to content</a>
 {open && <button aria-label="Close navigation" className="nav-overlay" onClick={()=>setOpen(false)} />}
 <aside className={'sidebar '+(open?'is-open':'')}><NavLink to="/" className="brand" onClick={()=>setOpen(false)}><span className="brand-mark"><GraduationCap size={25}/></span><span>edu<span className="brand-light">os</span><small>SCHOOL WORKSPACE</small></span></NavLink>
 <button className="mobile-close icon-button" aria-label="Close navigation" onClick={()=>setOpen(false)}><X size={20}/></button><div className="workspace-label">YOUR WORKSPACE</div>
 <nav aria-label="Main navigation">{links.map(([path,label,Icon],i)=><NavLink key={path} to={path} end={path==='/'} onClick={()=>setOpen(false)} className={({isActive})=>'nav-link '+(isActive?'active ':'')+(i===6?'nav-divider':'')}><Icon size={19}/><span>{label}</span>{path==='/attendance'&&<span className="nav-dot"/>}</NavLink>)}</nav>
 <div className="sidebar-bottom"><div className="school-card"><span className="school-icon"><GraduationCap size={20}/></span><strong>{school.data?.name || 'School workspace'}</strong><small>One school. One connected team.</small><NavLink to="/settings">Manage school <ArrowUpRight size={14}/></NavLink></div><button className="sign-out" onClick={logout}><LogOut size={17}/>Sign out</button></div></aside>
 <div className="workspace"><header className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-button" aria-label="Open navigation" onClick={()=>setOpen(true)}><Menu size={21}/></button><span>Workspace</span><span className="slash">/</span><strong>{active}</strong></div><div className="topbar-right"><span className="date-pill">{new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'})}</span><span className="topbar-separator"/><div className="user-info"><strong>{user?.firstName || user?.username}</strong><small>{user?.roles?.join(' · ') || 'Staff'}</small></div><span className="avatar">{(user?.firstName || user?.username || 'A').slice(0,1).toUpperCase()}</span></div></header>
 <main id="main" className="main-content">{children}</main><footer className="workspace-footer"><span>EduOS · School administration, thoughtfully connected.</span><span>Workspace v1.0</span></footer></div></div>
}
