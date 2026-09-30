import { FormEvent,useState } from 'react'
import client,{errorMessage} from '../api/client'
import { ErrorBox } from './UI'
export function PasswordRecovery(){
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setError('');setMessage('');setBusy(true);const form=e.currentTarget;try{const result=await client.post('/auth/reset-password',Object.fromEntries(new FormData(form)));setMessage(result.data.message);form.reset()}catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
 return <details className="school-options recovery-panel"><summary>Forgot password? Reset it with a recovery code</summary><p className="muted">Ask your school administrator to verify your identity and issue a one-time code. Codes expire after 15 minutes.</p>{error&&<ErrorBox message={error}/>} {message&&<div className="success-box" role="status">{message}</div>}<form onSubmit={submit}><label>Recovery code<input name="code" required minLength={64} maxLength={64} autoComplete="off"/></label><label>New password<input name="password" type="password" required minLength={16} maxLength={72} autoComplete="new-password"/></label><button className="button secondary login-submit" disabled={busy}>{busy?'Changing password…':'Reset password'}</button></form></details>
}
