import { useQuery } from '@tanstack/react-query'
import { LogOut } from 'lucide-react'
import client from '../api/client'
import { PageHeader } from '../components/UI'
import { useSignOut } from '../components/Shell'
import { useAuthStore } from '../store/auth'
import { isLeadership, portalName, roleOf } from '../roles'
import { data, label, type Options, type Row } from './suite/helpers'
import { accountInitials, accountKind, accountName } from './account'

// The signed-in person's own account, for every role. Read-only: EduOS has no API for changing your own details, so
// nothing here looks editable. Everything shown comes from the verified session or from lists the API already limits
// to this account (a teacher's classes, a family's linked students). No internal ids are shown.
export default function AccountPage(){
 const user=useAuthStore(s=>s.user)!,role=roleOf(user),scope=user.dataScope,platform=scope==='platform',signOut=useSignOut()
 const school=useQuery({queryKey:['school',user.schoolId,role],enabled:!platform,queryFn:async()=>(await client.get(isLeadership(role)?'/schools/'+user.schoolId:'/suite/school')).data.data})
 const options=useQuery<Options>({queryKey:['suite','options'],enabled:scope==='teacher'||scope==='parent'||scope==='student',queryFn:()=>data('/options')})
 const classes=useQuery<{data:Row[]}>({queryKey:['suite','classes','dashboard',''],enabled:scope==='teacher',queryFn:()=>data('/records/classes')})
 const teaching=useQuery<{data:Row[]}>({queryKey:['suite','teaching-assignments','dashboard',''],enabled:scope==='teacher',queryFn:()=>data('/records/teaching-assignments')})
 const allocations=useQuery<Row[]>({queryKey:['suite','allocations'],enabled:scope==='parent'||scope==='student',queryFn:()=>data('/allocations')})
 const classIds=[...new Set([...(classes.data?.data||[]).map(c=>c.id),...(teaching.data?.data||[]).map(a=>a.classId)])]
 const subjects=[...new Set((teaching.data?.data||[]).map(a=>label(options.data,'subjects',a.subjectId)))]
 const students=(options.data?.students||[]).map(s=>({name:s.label,className:label(options.data,'classes',allocations.data?.find(a=>a.studentId===s.id)?.classId)}))
 const rows:[string,string][]=[['Name',accountName(user)],['Account type',accountKind(user)],['Sign-in name',user.username],['Email',user.email||'Not recorded'],[platform?'Workspace':'School',platform?'EduOS platform':school.data?.name||'…']]
 if(scope==='teacher'){rows.push(['My classes',classIds.map(id=>label(options.data,'classes',id)).join(', ')||'No classes linked yet']);rows.push(['My subjects',subjects.join(', ')||'No subjects assigned yet'])}
 if(scope==='student')rows.push(['Class',students[0]?.className&&students[0].className!=='—'?students[0].className:'Not allocated yet'])
 return <><PageHeader eyebrow={(portalName[role]||'Workspace').toUpperCase()} title="My account" description={platform?"Your EduOS platform account.":"Your EduOS account. To change any of these details, contact your school administrator."}/>
 <section className="panel account-card" aria-label="Account details"><div className="account-top"><span className="avatar account-avatar" aria-hidden="true">{accountInitials(user)}</span><div><h2>{accountName(user)}</h2><p>{accountKind(user)}{platform?'':school.data?.name?' · '+school.data.name:''}</p></div></div>
  <dl className="account-details">{rows.map(([term,value])=><div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}</dl>
  {scope==='parent'&&<div className="account-linked"><h3>Linked children</h3>{students.length?<ul>{students.map(s=><li key={s.name}><strong>{s.name}</strong><span>{s.className!=='—'?s.className:'Class not allocated yet'}</span></li>)}</ul>:<p>No children are linked to this account yet. Ask the school administrator to link them.</p>}</div>}
  <div className="account-actions"><button type="button" className="button secondary" onClick={signOut}><LogOut size={16}/>Sign out</button></div></section></>
}
