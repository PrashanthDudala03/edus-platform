import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, GraduationCap, LogOut, Settings } from 'lucide-react'
import client, { errorMessage } from '../../api/client'
import { authAPI } from '../../api/auth'
import { useAuthStore } from '../../store/auth'
import { Empty, ErrorBox, Loading } from '../../components/UI'
import { homeFor, roleOf } from '../../roles'
import { SchoolHomeView } from './SchoolHomeView'
import { setSkipSchoolHome, skipsSchoolHome, type HomeView } from './schoolHome'
// The school's own welcome page, shown full screen between sign-in and the role dashboard: no sidebar, no workspace top bar.
// It is not a dashboard and holds no personal records.
export default function SchoolHomePage(){
 const {user,refreshToken,clearAuth}=useAuthStore(),location=useLocation(),navigate=useNavigate(),cache=useQueryClient()
 const dashboard=homeFor(roleOf(user),user?.dataScope),fromSignIn=!!(location.state as {welcome?:boolean}|null)?.welcome
 const [skip,setSkip]=useState(()=>skipsSchoolHome(user))
 const home=useQuery<{home:HomeView|null,canManage:boolean}>({queryKey:['school-home'],retry:false,queryFn:async()=>(await client.get('/suite/home')).data.data})
 const logout=async()=>{try{await authAPI.logout(refreshToken)}catch{}finally{clearAuth();cache.clear();navigate('/login')}}
 if(home.isPending)return <div className="sh-screen"><Loading/></div>
 // Straight after sign-in, a school with nothing published (or a failed request) continues to the dashboard as it always did.
 if(fromSignIn&&!home.data?.home)return <Navigate to={dashboard} replace/>
 const canManage=!!home.data?.canManage&&!!user?.permissions.includes('school-home.manage'),published=home.data?.home
 const enter=<Link className="button primary" to={dashboard}>Enter Dashboard<ArrowRight size={17}/></Link>
 return <div className="sh-screen"><a className="skip-link" href="#main">Skip to content</a>
  <header className="sh-top"><span className="sh-brand"><span><GraduationCap size={18}/></span><span>edu<span className="brand-light">os</span></span></span>
   <div className="sh-top-actions"><span className="sh-user">Signed in as {user?.firstName||user?.username}</span>{canManage&&<Link className="button secondary small" aria-label="Manage School Home" to="/home/manage"><Settings size={15}/><span>Manage<span className="sh-wide"> School Home</span></span></Link>}<button type="button" className="button secondary small" onClick={logout}><LogOut size={15}/>Sign out</button></div></header>
  <main id="main" className="sh-body">{published?<><SchoolHomeView home={published} greeting={'Welcome'+(user?.firstName?', '+user.firstName:'')} actions={enter}/>
   <div className="sh-enter"><div className="sh-wrap"><label className="home-check"><input type="checkbox" checked={skip} onChange={e=>{setSkip(e.target.checked);if(user)setSkipSchoolHome(user,e.target.checked)}}/>Skip School Home next time</label>{enter}</div></div></>
  :<div className="sh-wrap sh-empty">{home.isError?<ErrorBox message={errorMessage(home.error)}/>:<section className="panel"><Empty title="School Home is not published yet" description={canManage?'Add your school’s story, people and photographs, then publish the page for your community.':'Your school has not published its home page yet.'}/></section>}{enter}</div>}</main>
  <footer className="sh-foot">EduOS · School administration, thoughtfully connected.</footer></div>
}
