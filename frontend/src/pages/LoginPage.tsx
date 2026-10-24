import { FormEvent, useState } from 'react'
import { Navigate, Link } from 'react-router-dom'
import axios from 'axios'
import { ArrowRight, GraduationCap, ShieldCheck, Eye, EyeOff, Check, Info } from 'lucide-react'
import { authAPI } from '../api/auth'
import { errorMessage } from '../api/client'
import { useAuthStore } from '../store/auth'
import { ErrorBox } from '../components/UI'
import { PasswordRecovery } from '../components/PasswordRecovery'
import { homeFor, roleOf } from '../roles'
import { PromoBanner } from './billing/shared'
import { afterSignIn, skipsSchoolHome } from './home/schoolHome'
import { schoolChoices } from './schoolChoices'
// One sign-in for every role. The portal opened afterwards follows the role in the verified account, not a choice made here.
// School users pass through School Home on the way, unless their school has not published one or they chose to skip it.
function loginError(e:unknown){
 if(axios.isAxiosError(e)&&e.response?.status===401)return 'The email, username or password is incorrect.'
 if(axios.isAxiosError(e)&&e.response?.status===429)return 'Too many sign-in attempts. Wait a minute and try again.'
 return errorMessage(e)
}
export default function LoginPage(){
 const {setAuth,isAuthenticated,user,notice}=useAuthStore()
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[show,setShow]=useState(false),[schools,setSchools]=useState<{id:string,name:string}[]>([])
  // When the same sign-in name and password belong to several schools, EduOS lists them and the person picks one by name.
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget),picked=(e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null,chosen=picked?.name==='school'?picked.value:'';setError('');setBusy(true)
  try{const r=await authAPI.login({username:String(f.get('username')).trim(),password:String(f.get('password')),schoolId:chosen||String(f.get('schoolId')||'').trim()});setAuth(r.user,r.accessToken,r.refreshToken)}
  catch(e){const offered=axios.isAxiosError(e)&&e.response?.status===409?schoolChoices(e.response.data):[];setSchools(offered);if(!offered.length)setError(loginError(e))}finally{setBusy(false)}}
 if(isAuthenticated&&user)return <Navigate to={afterSignIn(user,homeFor(roleOf(user),user?.dataScope),skipsSchoolHome(user))} state={{welcome:true}} replace/>
 return <div className="login-page"><section className="login-story"><div className="brand"><span className="brand-mark"><GraduationCap size={28}/></span><span>edu<span className="brand-light">os</span></span></div><div className="story-content"><span className="story-tag"><span/>THE SCHOOL WORKSPACE</span><h1>Big futures.<br/><em>Better school days.</em></h1><p>A little less busywork. A lot more room for the people who matter.</p><div className="workspace-scene" aria-hidden="true"><div className="scene-top"><span className="scene-symbol"><GraduationCap size={22}/></span><span>One place. Every possibility.</span><span className="scene-live">CONNECTED</span></div><div className="scene-grid"><div className="scene-tile scene-people"><span className="scene-label">YOUR COMMUNITY</span><div className="scene-avatars"><i>ST</i><i>TE</i><i>PA</i><i>AD</i></div><strong>Everyone belongs.</strong><small>Students · Teachers · Families</small></div><div className="scene-tile scene-day"><span className="scene-label">A MORE CONNECTED DAY</span><div><Check size={15}/><span>People in sync</span></div><div><Check size={15}/><span>Details in place</span></div><div><Check size={15}/><span>More time to teach</span></div></div><div className="scene-bottom"><span className="scene-orbit">✳</span><strong>More clarity.<br/>More possibility.</strong><ArrowRight size={25}/></div></div></div></div><small>Made for the people moving education forward.</small></section>
 <section className="login-form-side"><div className="login-form-wrap"><span className="eyebrow">WELCOME BACK</span><h2>Your day starts here.</h2><p>Welcome back. Sign in to your school workspace.</p><PromoBanner placement="login"/>{notice&&!error&&<div className="info-box" role="status"><Info size={18}/><span>{notice}</span></div>}{error&&<ErrorBox message={error}/>}<form onSubmit={submit}><label>Email or username<input name="username" required maxLength={255} autoComplete="username" placeholder="you@school.edu" autoFocus/></label><label>Password<div className="password-field"><input name="password" type={show?'text':'password'} required autoComplete="current-password" placeholder="Enter your password"/><button type="button" aria-label={show?'Hide password':'Show password'} onClick={()=>setShow(!show)}>{show?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label><details className="school-options"><summary>Signing in to another school?</summary><label>School ID<input name="schoolId" placeholder="School UUID provided by your administrator"/></label><small>Only needed if the same email or username is used in more than one school.</small></details>{schools.length>0&&<div className="school-choice" role="group" aria-label="Choose your school"><strong>Choose your school</strong><span>Your sign-in name is used in more than one school.</span>{schools.map(s=><button key={s.id} type="submit" name="school" value={s.id} className="button secondary" disabled={busy}>{s.name}</button>)}</div>}<button className="button primary login-submit" disabled={busy}>{busy?'Signing in…':'Continue to workspace'}<ArrowRight size={18}/></button></form><PasswordRecovery/><p><Link to="/signup">Create account</Link></p><div className="login-help"><ShieldCheck size={19}/><p>Need an account or a password reset?<br/><strong>Contact your school administrator.</strong></p></div></div><div className="login-footer">EduOS · Your school. Beautifully organized.</div></section></div>
}
