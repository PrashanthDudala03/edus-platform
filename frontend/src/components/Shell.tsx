import { ReactNode, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LayoutDashboard, GraduationCap, Users, BookOpen, CalendarCheck, Megaphone, ShieldCheck, Settings, LogOut, Menu, X, ArrowUpRight, Layers } from 'lucide-react'
import { useAuthStore } from '../store/auth'
import { authAPI } from '../api/auth'
import client from '../api/client'
const adminLinks = [
 ['/', 'Overview', LayoutDashboard], ['/suite','All school modules',Layers],
 ['/suite/admissions','Admissions',GraduationCap],['/students','Student records',Users],['/parents','Parents & guardians',Users],
 ['/suite/academic-years','Academic years',BookOpen],['/suite/classes','Classes & sections',BookOpen],['/suite/subjects','Subjects',BookOpen],['/suite/allocation','Student promotion',GraduationCap],
 ['/suite/register','Student attendance',CalendarCheck],['/suite/staff-attendance','Staff attendance',CalendarCheck],['/suite/leave-requests','Leave approvals',CalendarCheck],
 ['/suite/fees','Fees & receipts',ShieldCheck],['/suite/fee-structures','Fee structures',ShieldCheck],
 ['/suite/exams','Exams & schedules',BookOpen],['/suite/marks','Marks & remarks',BookOpen],
 ['/suite/circulars','Circulars & acknowledgements',Megaphone],['/suite/messages','Targeted messages',Megaphone],['/suite/calendar','School calendar',CalendarCheck],['/announcements','Admin noticeboard',Megaphone],
 ['/suite/homework','Homework & assignments',BookOpen],['/suite/submissions','Submissions & feedback',GraduationCap],
 ['/teachers','Teacher profiles',Users],['/suite/teaching-assignments','Teaching assignments',Users],['/suite/timetable','Weekly timetable',CalendarCheck],
 ['/suite/certificates','Certificates & ID cards',GraduationCap],['/suite/reports','Reports & Excel imports',ShieldCheck],
 ['/suite/account-links','Account profile links',Users],['/suite/school-config','Branding & print settings',Settings],['/audit','Activity log',ShieldCheck],['/settings','School settings & accounts',Settings],
] as const
export function Shell({children}:{children:ReactNode}) {
 const [open,setOpen]=useState(false),[menuSearch,setMenuSearch]=useState("")
 const {user,refreshToken,clearAuth}=useAuthStore()
 const admin=!!user?.roles.some(r=>["SuperAdmin","Principal"].includes(r))
 const links=admin?adminLinks:([ ["/suite","My workspace",LayoutDashboard],["/suite/circulars","Circulars",Megaphone],["/suite/calendar","School calendar",CalendarCheck],["/suite/homework","Homework",BookOpen],["/suite/submissions","Submissions",GraduationCap],["/suite/timetable","Timetable",CalendarCheck],["/suite/messages","Messages",Megaphone],["/suite/reports","Reports",ShieldCheck], ...(user?.roles.includes("Teacher")?[["/suite/register","Student register",CalendarCheck],["/suite/leave-requests","Leave requests",Users]]:[["/suite/fees","Fees & receipts",ShieldCheck],["/suite/certificates","Certificates",BookOpen]]) ] as [string,string,typeof LayoutDashboard][])
 const cache=useQueryClient(),navigate=useNavigate(),location=useLocation()
 const school=useQuery({queryKey:['school',user?.schoolId],queryFn:async()=>(await client.get(admin?'/schools/'+user?.schoolId:'/suite/school')).data.data})
 const active=links.find(([path])=>path===location.pathname)?.[1] || 'Workspace'
 const logout=async()=>{try{await authAPI.logout(refreshToken)}catch{}finally{clearAuth();cache.clear();navigate('/login')}}
 return <div className="app-shell"><a className="skip-link" href="#main">Skip to content</a>
 {open && <button aria-label="Close navigation" className="nav-overlay" onClick={()=>setOpen(false)} />}
 <aside className={'sidebar '+(open?'is-open':'')}><NavLink to="/" className="brand" onClick={()=>setOpen(false)}><span className="brand-mark"><GraduationCap size={25}/></span><span>edu<span className="brand-light">os</span><small>SCHOOL WORKSPACE</small></span></NavLink>
 <button className="mobile-close icon-button" aria-label="Close navigation" onClick={()=>setOpen(false)}><X size={20}/></button><div className="workspace-label">YOUR WORKSPACE</div>
 <label className="nav-search">Find a school feature<input type="search" value={menuSearch} onChange={e=>setMenuSearch(e.target.value)} placeholder="Search menu..."/></label><nav aria-label="Main navigation">{links.filter(([,label])=>label.toLowerCase().includes(menuSearch.toLowerCase())).map(([path,label,Icon])=><NavLink key={path} to={path} end={path==='/'||path==='/suite'} onClick={()=>setOpen(false)} className={({isActive})=>'nav-link '+(isActive?'active ':'')}><Icon size={19}/><span>{label}</span>{path==='/attendance'&&<span className="nav-dot"/>}</NavLink>)}</nav>
 <div className="sidebar-bottom"><div className="school-card"><span className="school-icon"><GraduationCap size={20}/></span><strong>{school.data?.name || 'School workspace'}</strong><small>One school. One connected team.</small><NavLink to={admin?"/settings":"/suite"}>{admin?"Manage school":"My workspace"} <ArrowUpRight size={14}/></NavLink></div><button className="sign-out" onClick={logout}><LogOut size={17}/>Sign out</button></div></aside>
 <div className="workspace"><header className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-button" aria-label="Open navigation" onClick={()=>setOpen(true)}><Menu size={21}/></button><span>Workspace</span><span className="slash">/</span><strong>{active}</strong></div><div className="topbar-right"><span className="date-pill">{new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'})}</span><span className="topbar-separator"/><div className="user-info"><strong>{user?.firstName || user?.username}</strong><small>{user?.roles?.join(' · ') || 'Staff'}</small></div><span className="avatar">{(user?.firstName || user?.username || 'A').slice(0,1).toUpperCase()}</span></div></header>
 <main id="main" className="main-content">{children}</main><footer className="workspace-footer"><span>EduOS · School administration, thoughtfully connected.</span><span>Workspace v1.0</span></footer></div></div>
}
