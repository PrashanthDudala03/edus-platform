import { FormEvent, useState } from 'react'
import { Navigate } from 'react-router-dom'
import axios from 'axios'
import { ArrowRight, GraduationCap, ShieldCheck, Eye, EyeOff, Check, Info } from 'lucide-react'
import { authAPI } from '../api/auth'
import { errorMessage } from '../api/client'
import { useAuthStore } from '../store/auth'
import { ErrorBox } from '../components/UI'
import { PasswordRecovery } from '../components/PasswordRecovery'
import { homeFor, roleOf } from '../roles'
// One sign-in for every role. The portal opened afterwards follows the role in the verified account, not a choice made here.
function loginError(e:unknown){
 if(axios.isAxiosError(e)&&e.response?.status===401)return 'The email, username or password is incorrect.'
 if(axios.isAxiosError(e)&&e.response?.status===429)return 'Too many sign-in attempts. Wait a minute and try again.'
 return errorMessage(e)
}
export default function LoginPage(){
 const {setAuth,isAuthenticated,user,notice}=useAuthStore()
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[show,setShow]=useState(false)
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);setError('');setBusy(true);try{const r=await authAPI.login({username:String(f.get('username')).trim(),password:String(f.get('password')),schoolId:String(f.get('schoolId')||'').trim()});setAuth(r.user,r.accessToken,r.refreshToken)}catch(e){setError(loginError(e))}finally{setBusy(false)}}
 if(isAuthenticated&&user)return <Navigate to={homeFor(roleOf(user))} replace/>
 return <div className="login-page"><section className="login-story"><div className="brand"><span className="brand-mark"><GraduationCap size={28}/></span><span>edu<span className="brand-light">os</span></span></div><div className="story-content"><span className="story-tag"><span/>A better school day starts here</span><h1>Less administration.<br/><em>More possibility.</em></h1><p>Bring your people, daily routines, and school community together in one calm, connected workspace.</p><div className="story-points"><span><Check size={17}/>Your school, in focus</span><span><Check size={17}/>Every record, connected</span><span><Check size={17}/>Built for your team</span></div><div className="story-art" aria-hidden="true"><div className="art-ring"/><div className="art-card"><GraduationCap size={30}/><strong>A little more clarity.</strong><span>A lot more time for students.</span><div className="art-bars"><i/><i/><i/><i/><i/><i/><i/></div></div><span className="art-badge"><ShieldCheck size={18}/>A dedicated school workspace</span></div></div><small>Thoughtfully built for the people behind every school.</small></section>
 <section className="login-form-side"><div className="login-form-wrap"><span className="eyebrow">WELCOME TO EDUOS</span><h2>Good to see you.</h2><p>Sign in with the account your school gave you. You will go straight to your own portal.</p>{notice&&!error&&<div className="info-box" role="status"><Info size={18}/><span>{notice}</span></div>}{error&&<ErrorBox message={error}/>}<form onSubmit={submit}><label>Email or username<input name="username" required maxLength={255} autoComplete="username" placeholder="you@school.edu" autoFocus/></label><label>Password<div className="password-field"><input name="password" type={show?'text':'password'} required autoComplete="current-password" placeholder="Enter your password"/><button type="button" aria-label={show?'Hide password':'Show password'} onClick={()=>setShow(!show)}>{show?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label><details className="school-options"><summary>Signing in to another school?</summary><label>School ID<input name="schoolId" placeholder="School UUID provided by your administrator"/></label><small>Only needed if the same email or username is used in more than one school.</small></details><button className="button primary login-submit" disabled={busy}>{busy?'Signing in…':'Sign in to workspace'}<ArrowRight size={18}/></button></form><PasswordRecovery/><div className="login-help"><ShieldCheck size={19}/><p>Need an account or a password reset?<br/><strong>Contact your school administrator.</strong></p></div></div><div className="login-footer">EduOS · Your school. Beautifully organized.</div></section></div>
}
