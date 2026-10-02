import { ReactNode, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import client, { errorMessage } from '../../api/client'
import { authAPI } from '../../api/auth'
import { useAuthStore } from '../../store/auth'
import { Empty, ErrorBox, Loading } from '../../components/UI'
import { homeFor, roleOf } from '../../roles'
import { SchoolWelcome } from './SchoolHomeView'
import { setSkipSchoolHome, skipsSchoolHome, type HomeView } from './schoolHome'
// Both pages below are standalone: no sidebar, no workspace top bar, no assistant button. The school is the subject, not the workspace.
function Notice({children,action}:{children:ReactNode,action:ReactNode}){return <div className="sw sw-notice"><main id="main">{children}{action}</main></div>}
/** The published School Welcome page, shown between sign-in and the role dashboard. It holds no personal records. */
export default function SchoolHomePage(){
 const {user,refreshToken,clearAuth}=useAuthStore(),location=useLocation(),navigate=useNavigate(),cache=useQueryClient()
 const dashboard=homeFor(roleOf(user),user?.dataScope),fromSignIn=!!(location.state as {welcome?:boolean}|null)?.welcome
 const [skip,setSkip]=useState(()=>skipsSchoolHome(user))
 const home=useQuery<{home:HomeView|null,canManage:boolean}>({queryKey:['school-home'],retry:false,queryFn:async()=>(await client.get('/suite/home')).data.data})
 const logout=async()=>{try{await authAPI.logout(refreshToken)}catch{}finally{clearAuth();cache.clear();navigate('/login')}}
 if(home.isPending)return <div className="sw sw-notice"><Loading/></div>
 // Straight after sign-in, a school with nothing published (or a failed request) continues to the dashboard as it always did.
 if(fromSignIn&&!home.data?.home)return <Navigate to={dashboard} replace/>
 const canManage=!!home.data?.canManage&&!!user?.permissions.includes('school-home.manage')
 if(!home.data?.home)return <Notice action={<Link className="button primary" to={dashboard}>Enter Dashboard<ArrowRight size={17}/></Link>}>{home.isError?<ErrorBox message={errorMessage(home.error)}/>
  :<section className="panel"><Empty title="School Home is not published yet" description={canManage?'Add your school’s story, people and photographs, then publish the page for your community.':'Your school has not published its home page yet.'}/></section>}</Notice>
 return <SchoolWelcome home={home.data.home} dashboard={dashboard} firstName={user?.firstName} canManage={canManage} onSignOut={logout}>
  <label className="home-check sw-skip"><input type="checkbox" checked={skip} onChange={e=>{setSkip(e.target.checked);if(user)setSkipSchoolHome(user,e.target.checked)}}/>Skip School Home next time</label></SchoolWelcome>
}
/** The administrator's preview: the same standalone page drawn from the saved draft. The API refuses it without the manage permission. */
export function SchoolHomePreviewPage(){
 const user=useAuthStore(s=>s.user),dashboard=homeFor(roleOf(user),user?.dataScope)
 const draft=useQuery<HomeView>({queryKey:['school-home-preview'],gcTime:0,retry:false,queryFn:async()=>(await client.get('/suite/home/preview')).data.data})
 if(draft.isPending)return <div className="sw sw-notice"><Loading/></div>
 if(draft.isError)return <Notice action={<Link className="button primary" to="/home/manage"><ArrowLeft size={17}/>Back to management</Link>}><ErrorBox message={errorMessage(draft.error)}/></Notice>
 return <SchoolWelcome home={draft.data} dashboard={dashboard} firstName={user?.firstName} preview/>
}
