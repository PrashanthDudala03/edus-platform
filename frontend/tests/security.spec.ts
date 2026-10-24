import { seedIamSql, clearIamSql } from './iam-fixtures'
import {test,expect,APIRequestContext,APIResponse} from '@playwright/test'
import {readFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import path from 'node:path'
// Security regression: two isolated QA schools prove role limits, tenant isolation by object id,
// header/scope spoofing, session revocation and network isolation against the real Docker stack.
const root=path.resolve(import.meta.dirname,'../..')
const env=Object.fromEntries(readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(x=>x&&!x.startsWith('#')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)]}))
const password=env.EDUOS_BOOTSTRAP_ADMIN_PASSWORD,day=new Date().toISOString().slice(0,10)
const sql=(query:string)=>execFileSync('docker',['compose','exec','-T','postgres','psql','-U',env.POSTGRES_USER,'-d',env.POSTGRES_DB,'-v','ON_ERROR_STOP=1','-c',query],{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe']})
type School={id:string,tag:string,adminId:string,tokens:Record<string,any>,users:Record<string,string>,year:string,cl:string,subject:string,scheme:string,head:string,teacher:string,admission:string,student:string,circular:string,homework:string,document:string,certificate:string,slot:string,leaveType:string,period:string,leave:string}
const school=(tag:string):School=>({id:randomUUID(),tag,adminId:randomUUID(),tokens:{},users:{},year:'',cl:'',subject:'',scheme:'',head:'',teacher:'',admission:'',student:'',circular:'',homework:'',document:'',certificate:'',slot:'',leaveType:'',period:'',leave:''})
const A=school('a'),B=school('b'),lower=['Teacher','Parent','Student']
let api:APIRequestContext
const bearer=(s:School,role:string)=>({Authorization:'Bearer '+s.tokens[role].accessToken})
const call=(s:School,role:string,method:string,url:string,body?:any,extra:Record<string,string>={})=>api.fetch('/api/v1'+url,{method,headers:{...bearer(s,role),...extra},...(body===undefined?{}:{data:body})})
async function ok(s:School,role:string,method:string,url:string,body?:any,status=200){const r=await call(s,role,method,url,body);expect(r.status(),role+' '+method+' '+url+' '+await r.text()).toBe(status);return(await r.json()).data}
async function denied(s:School,role:string,method:string,url:string,body?:any,status=403,extra?:Record<string,string>){const r=await call(s,role,method,url,body,extra);expect(r.status(),role+' '+method+' '+url+' expected '+status+' got '+await r.text()).toBe(status)}
const username=(s:School,role:string)=>'sec.'+s.tag+'.'+role.toLowerCase()
// nginx limits login and reset-password to 10/min per client (burst 10); wait out a 429 instead of starving later specs.
async function throttled(send:()=>Promise<APIResponse>){for(let i=0;;i++){const r=await send();if(r.status()!==429||i>=15)return r;await new Promise(f=>setTimeout(f,6500))}}
const loginRequest=(data:any)=>throttled(()=>api.post('/api/v1/auth/login',{data}))
async function login(s:School,role:string,pw=password){const r=await loginRequest({schoolId:s.id,username:username(s,role),password:pw});expect(r.status(),await r.text()).toBe(200);s.tokens[role]=(await r.json()).data}
// School B only needs an administrator session: its other accounts exist as cross-school targets, not callers.
async function bootstrap(s:School,signInRoles:string[]){
 const roleId=randomUUID()
 sql("BEGIN; INSERT INTO school_db.schools(id,name) VALUES('"+s.id+"','Security QA "+s.tag+"'); INSERT INTO auth_db.roles(id,school_id,name) VALUES('"+roleId+"','"+s.id+"','Administrator'); "+['Principal','Teacher','Parent','Student'].map(r=>"INSERT INTO auth_db.roles(id,school_id,name) VALUES(gen_random_uuid(),'"+s.id+"','"+r+"');").join(' ')+" INSERT INTO auth_db.users(id,school_id,username,email,password_hash,first_name,last_name,role_id) SELECT '"+s.adminId+"','"+s.id+"','"+username(s,'Administrator')+"','sec-"+s.id+"@example.test',password_hash,'Security','Admin','"+roleId+"' FROM auth_db.users WHERE school_id='"+env.EDUOS_BOOTSTRAP_SCHOOL_ID+"' AND username='"+env.EDUOS_BOOTSTRAP_ADMIN_USERNAME.replaceAll("'","''")+"'; COMMIT;")
  sql(seedIamSql(s.id))
 await login(s,'Administrator')
 const roles=await ok(s,'Administrator','GET','/roles')
 for(const role of lower){
  s.users[role]=(await ok(s,'Administrator','POST','/users',{schoolId:s.id,roleId:roles.find((r:any)=>r.name===role).id,username:username(s,role),email:role.toLowerCase()+'-'+s.id+'@example.test',firstName:role,lastName:'QA',password},201)).id
  if(signInRoles.includes(role))await login(s,role)
 }
 const create=async(kind:string,body:any,role='Administrator')=>(await ok(s,role,'POST','/suite/records/'+kind,body,201)).id
 s.year=await create('academic-years',{name:'2026-27',startsOn:'2026-04-01',endsOn:'2027-03-31',status:'Current'})
 s.teacher=(await ok(s,'Administrator','POST','/teachers',{schoolId:s.id,employeeCode:'SEC-'+s.tag,firstName:'Sec',lastName:'Teacher',email:'teacher-'+s.id+'@example.test',phoneNumber:'9000000002',department:'Science'},201)).id
 s.cl=await create('classes',{name:'Grade 7',section:s.tag.toUpperCase(),yearId:s.year,teacherId:s.teacher,capacity:30})
 s.subject=await create('subjects',{name:'Maths',code:'MAT'})
 s.head=await create('fee-heads',{name:'Tuition',code:'TUI',active:'Yes'})
 s.scheme=await create('assessment-schemes',{name:'Theory and practical',type:'Components',components:'Theory:70:28, Practical:30',grades:'A:90, B:75, C:60, D:40, E:0'})
 await create('teaching-assignments',{classId:s.cl,subjectId:s.subject,teacherId:s.teacher})
 s.slot=await create('period-slots',{name:'Period 1',order:1,startsAt:'09:00',endsAt:'09:45',type:'Teaching'})
 s.period=await create('timetable',{classId:s.cl,subjectId:s.subject,teacherId:s.teacher,day:'Monday',slotId:s.slot,room:'R1'})
 s.leaveType=await create('leave-types',{name:'Casual leave',code:'CL',paid:'Paid',yearlyAllowance:12,tracksBalance:'Yes',active:'Yes'})
 s.admission=await create('admissions',{admissionNumber:'SEC-'+s.tag+'-001',firstName:'Riya',lastName:'Learner',dateOfBirth:'2014-05-01',gender:'Female',email:'riya-'+s.id+'@example.test',phoneNumber:'9000000003',guardianName:'Kiran Guardian',guardianEmail:'kiran-'+s.id+'@example.test',guardianPhone:'9'+Date.now().toString().slice(-9),address:'1 School Lane',classId:s.cl,status:'Submitted'})
 s.student=(await ok(s,'Administrator','POST','/suite/admissions/'+s.admission+'/accept')).studentId
 await create('account-links',{userId:s.users.Teacher,teacherId:s.teacher})
 await create('account-links',{userId:s.users.Parent,studentId:s.student})
 await create('account-links',{userId:s.users.Student,studentId:s.student})
 for(const role of signInRoles.filter(r=>r!=='Administrator'))await login(s,role)
 s.circular=await create('circulars',{title:'Notice '+s.tag,message:'Read and acknowledge.',audience:'All',dueDate:day})
 s.homework=await create('homework',{title:'Fractions',classId:s.cl,subjectId:s.subject,dueDate:day,instructions:'Solve the worksheet.'},signInRoles.includes('Teacher')?'Teacher':'Administrator')
 s.leave=await create('leave-requests',{teacherId:s.teacher,typeId:s.leaveType,fromDate:'2030-03-04',toDate:'2030-03-04',reason:'Private reason '+s.tag,status:'Pending'},signInRoles.includes('Teacher')?'Teacher':'Administrator')
 s.certificate=await create('certificates',{studentId:s.student,type:'Bonafide certificate',issuedOn:day,remarks:'Verification.'})
 const upload=await api.post('/api/v1/suite/documents?recordId='+s.admission,{headers:bearer(s,'Administrator'),multipart:{file:{name:'form.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nSecurity QA '+s.tag+'\n%%EOF')}}})
 expect(upload.status(),await upload.text()).toBe(201);s.document=(await upload.json()).data.id
}
// Builds a body that passes field validation for a catalog module, so a refusal is a real 403 and not a 400.
function sample(fields:any[],refs:Record<string,string>){
 const body:Record<string,any>={}
 for(const f of fields){
  if(!f.required&&f.type!=='reference')continue
  body[f.key]=f.type==='select'?f.options[0]:f.type==='date'?day:f.type==='time'?'09:00':f.type==='number'||f.type==='money'?'10':f.type==='email'?'sample@example.test':f.type==='reference'?(refs[f.source]??randomUUID()):'Sample'
 }
 return body
}
test.describe.serial('Security boundaries against real Docker services',()=>{
 test.describe.configure({timeout:120000})
 test.beforeAll(async({playwright})=>{
  test.setTimeout(240000)
  api=await playwright.request.newContext({baseURL:process.env.EDUOS_TEST_URL||'http://localhost:8080'})
  await bootstrap(A,lower);await bootstrap(B,[])
 })
 test.afterAll(async()=>{
  await api?.dispose()
  const tables=['notify.communication_settings','notify.settings_history','notify.school_settings','notify.deliveries','notify.recipients','notify.notifications','notify.preferences','notify.devices','notify.template_overrides','suite.documents','suite.acknowledgements','suite.payments','suite.charges','suite.student_classes','suite.records','suite.counters','school_db.attendance','student_db.students','teacher_db.teachers','parent_db.parents','school_db.announcements','auth_db.password_resets','auth_db.refresh_tokens','auth_db.users']
  for(const s of [A,B]){
   sql("BEGIN; "+clearIamSql(s.id)+tables.map(t=>"DELETE FROM "+t+" WHERE school_id='"+s.id+"';").join(' ')+" DELETE FROM auth_db.role_permissions WHERE role_id IN(SELECT id FROM auth_db.roles WHERE school_id='"+s.id+"'); DELETE FROM auth_db.roles WHERE school_id='"+s.id+"'; DELETE FROM school_db.schools WHERE id='"+s.id+"'; DELETE FROM school_db.audit_logs WHERE school_id='"+s.id+"'; DELETE FROM suite.audit WHERE school_id='"+s.id+"'; COMMIT;")
   if(s.document)execFileSync('docker',['compose','exec','-T','school-service','rm','-f','--','/app/documents/'+s.document.replaceAll('-','')+'.bin'],{cwd:root,stdio:'pipe'})
  }
 })

 test('school branding is isolated, readable by school roles and protected from teacher edits',async()=>{
  const manage=await ok(A,'Administrator','GET','/suite/home/manage')
  const draft={...manage.draft,brand:{primary:'#7a1f2b',accent:'#d4a53a'}}
  await ok(A,'Administrator','PUT','/suite/home',{draft,version:manage.version,action:'save'})
  const branded=await ok(A,'Teacher','GET','/suite/branding')
  expect(branded.schoolId).toBe(A.id);expect(branded.brand).toEqual(draft.brand)
  await denied(B,'Administrator','GET','/suite/branding?schoolId='+A.id)
  const other=await ok(B,'Administrator','GET','/suite/branding')
  expect(other.schoolId).toBe(B.id);expect(other.brand).toBeNull()
  await denied(A,'Teacher','PUT','/suite/home',{draft,version:manage.version+1,action:'save'})
  expect((await api.get('/api/v1/suite/branding')).status()).toBe(401)
 })

 test('students and parents keep their own actions: homework submission and circular acknowledgement',async()=>{
  const submission=(await ok(A,'Student','POST','/suite/records/submissions',{homeworkId:A.homework,studentId:A.student,response:'Half plus a quarter.'},201)).id
  expect((await ok(A,'Student','GET','/suite/records/submissions')).data.map((r:any)=>r.id)).toEqual([submission])
  await ok(A,'Student','POST','/suite/circulars/'+A.circular+'/acknowledge')
  await ok(A,'Parent','POST','/suite/circulars/'+A.circular+'/acknowledge')
  expect((await ok(A,'Administrator','GET','/suite/circulars/'+A.circular+'/acknowledgements')).length).toBe(2)
  expect((await ok(A,'Parent','GET','/suite/report-cards/'+A.student)).student.id).toBe(A.student)
  await ok(A,'Parent','GET','/suite/fees');await ok(A,'Student','GET','/suite/fees')
 })

 test('timetable, leave and substitutions stay inside the school and leave reasons stay with staff',async()=>{
  // Another school's period, teacher or leave is unknown here: refused before any rule runs, with nothing learned.
  await denied(A,'Administrator','POST','/suite/records/substitutions',{date:'2030-03-04',timetableId:B.period,teacherId:A.teacher},404)
  await denied(A,'Administrator','POST','/suite/records/substitutions',{date:'2030-03-04',timetableId:A.period,teacherId:B.teacher},400)
  await denied(A,'Administrator','POST','/suite/records/timetable',{classId:A.cl,subjectId:A.subject,teacherId:B.teacher,day:'Tuesday',slotId:A.slot},400)
  await denied(A,'Administrator','GET','/suite/leave/'+B.leave+'/impact',undefined,404)
  await denied(A,'Administrator','POST','/suite/leave/'+B.leave+'/decision',{decision:'Approved',remark:'x'},404)
  await denied(A,'Administrator','GET','/suite/timetable/candidates?timetableId='+B.period+'&date=2030-03-04',undefined,404)
  await denied(A,'Administrator','GET','/suite/leave/balances?teacherId='+B.teacher,undefined,404)
  expect((await ok(A,'Administrator','GET','/suite/timetable/week?classId='+B.cl+'&date=2030-03-04')).periods).toEqual([])
  expect((await ok(A,'Administrator','GET','/suite/records/substitutions')).data).toEqual([])
  // Only an approver decides, and only for their own school; a teacher never decides, not even their own request.
  await denied(A,'Teacher','POST','/suite/leave/'+A.leave+'/decision',{decision:'Approved',remark:'self'})
  for(const role of lower){await denied(A,role,'GET','/suite/leave/queue');await denied(A,role,'GET','/suite/timetable/operations');await denied(A,role,'POST','/suite/records/substitutions',{date:'2030-03-04',timetableId:A.period,teacherId:A.teacher})}
  for(const role of ['Parent','Student']){await denied(A,role,'GET','/suite/records/leave-requests');await denied(A,role,'GET','/suite/leave/'+A.leave+'/impact');await denied(A,role,'GET','/suite/leave/balances')
   const family=await ok(A,role,'GET','/suite/timetable/week?date=2030-03-04');expect(JSON.stringify(family)).not.toContain('Private reason');expect(family.office).toBe(false)}
  // A teacher reads their own leave, balance and impact, and nobody else's balance.
  expect((await ok(A,'Teacher','GET','/suite/leave/'+A.leave+'/impact')).teacherId).toBe(A.teacher)
  expect((await ok(A,'Teacher','GET','/suite/leave/balances')).teacherId).toBe(A.teacher)
  await denied(A,'Teacher','GET','/suite/leave/balances?teacherId='+B.teacher)
  await denied(A,'Teacher','GET','/suite/timetable/week?teacherId='+B.teacher)
 })
 test('admissions and onboarding stay inside the school and with the office',async()=>{
  // A fresh application of school A, approved and in onboarding, to try foreign records against.
  const app=(await ok(A,'Administrator','POST','/suite/records/admissions',{firstName:'Isha',lastName:'Isolation',dateOfBirth:'2015-02-02',gender:'Female',email:'isha-'+A.id+'@example.test',guardianName:'Kiran Guardian',guardianEmail:'kiran-'+A.id+'@example.test',guardianPhone:'9111111111',address:'1 School Lane',classId:A.cl,status:'Submitted'},201)).id
  for(const to of ['Under Review','Approved'])await ok(A,'Administrator','POST','/suite/admissions/'+app+'/transition',{to,acknowledgeDuplicates:true})
  await ok(A,'Administrator','POST','/suite/admissions/'+app+'/onboarding/start')
  // psql prints a dashed separator before the value: match a real UUID, not the separator line.
  const bParent=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(sql("SELECT id FROM parent_db.parents WHERE school_id='"+B.id+"' LIMIT 1"))![0]
  const bStructure=(await ok(B,'Administrator','POST','/suite/records/fee-structures',{name:'B fee',classId:B.cl,amount:10,installment:'Term 1',dueDate:day},201)).id
  // Another school's application, class, guardian, fee structure and account are unknown here: 404, nothing learned.
  await denied(A,'Administrator','GET','/suite/admissions/'+B.admission,undefined,404)
  await denied(A,'Administrator','POST','/suite/admissions/'+B.admission+'/transition',{to:'Withdrawn',reason:'x'},404)
  await denied(A,'Administrator','POST','/suite/admissions/'+B.admission+'/activate',undefined,404)
  await denied(A,'Administrator','GET','/suite/admissions/'+B.admission+'/candidates',undefined,404)
  const before=await ok(A,'Administrator','GET','/suite/admissions/'+app)
  await denied(A,'Administrator','PUT','/suite/admissions/'+app+'/onboarding',{section:'academics',classId:B.cl},404)
  await denied(A,'Administrator','PUT','/suite/admissions/'+app+'/onboarding',{section:'guardian',mode:'existing',parentId:bParent,relationship:'Mother',confirmed:true},404)
  await denied(A,'Administrator','PUT','/suite/admissions/'+app+'/onboarding',{section:'fees',mode:'assign',structureIds:[bStructure]},404)
  await denied(A,'Administrator','PUT','/suite/admissions/'+app+'/onboarding',{section:'accounts',parentUserId:B.users.Parent},400)
  // A malformed id is still a plain validation error inside the school, and none of the refused requests changed anything.
  await denied(A,'Administrator','PUT','/suite/admissions/'+app+'/onboarding',{section:'guardian',mode:'existing',parentId:'not-an-id',relationship:'Mother',confirmed:true},400)
  const after=await ok(A,'Administrator','GET','/suite/admissions/'+app)
  expect([after.version,after.status,after.onboarding.guardian,after.onboarding.academics.classId,after.onboarding.fees.mode,after.onboarding.accounts]).toEqual([before.version,'Onboarding',before.onboarding.guardian,A.cl,'',{}])
  expect(sql("SELECT 'n='||count(*) FROM student_db.students WHERE school_id='"+A.id+"' AND email='isha-"+A.id+"@example.test'")).toContain('n=0')
  expect((await ok(A,'Administrator','GET','/suite/admissions/pipeline')).items.map((i:any)=>i.id)).not.toContain(B.admission)
  // Teachers, parents and students hold no admissions or onboarding access at all.
  for(const role of lower){
   await denied(A,role,'GET','/suite/admissions/pipeline');await denied(A,role,'GET','/suite/admissions/'+app)
   await denied(A,role,'POST','/suite/admissions/'+app+'/transition',{to:'Withdrawn',reason:'x'});await denied(A,role,'POST','/suite/admissions/'+app+'/onboarding/start')
   await denied(A,role,'PUT','/suite/admissions/'+app+'/onboarding',{section:'details',confirmed:true});await denied(A,role,'POST','/suite/admissions/'+app+'/activate')
  }
 })
 test('fees stay with the office and the linked family: ledgers, receipts, concessions, reversals and provider events',async()=>{
  const structure=(await ok(A,'Administrator','POST','/suite/records/fee-structures',{name:'Tuition',classId:A.cl,amount:1000,installment:'Term 1',dueDate:day},201)).id
  const charge=(await ok(A,'Administrator','POST','/suite/fees/charges',{studentId:A.student,structureId:structure,concession:'0'},201)).id
  // The family reads its own ledger; a teacher reads no financial detail at all; another family's child is refused before any lookup.
  for(const role of ['Parent','Student','Administrator'])expect((await ok(A,role,'GET','/suite/fees/ledger/'+A.student)).totals.net).toBe(1000)
  await denied(A,'Teacher','GET','/suite/fees/ledger/'+A.student);await denied(A,'Teacher','GET','/suite/fees');await denied(A,'Teacher','GET','/suite/fees/summary')
  for(const role of ['Parent','Student','Teacher'])await denied(A,role,'GET','/suite/fees/ledger/'+B.student)
  await denied(A,'Administrator','GET','/suite/fees/ledger/'+B.student,undefined,404)
  // Only the office collects, concedes, reverses or changes settings; the same payment twice is one payment.
  const payment={chargeId:charge,amount:400,method:'Cash',reference:'',paidOn:day,idempotencyKey:randomUUID()}
  for(const role of ['Parent','Student','Teacher'])await denied(A,role,'POST','/suite/fees/payments',payment)
  const first=await ok(A,'Administrator','POST','/suite/fees/payments',payment,201);expect((await ok(A,'Administrator','POST','/suite/fees/payments',payment)).id).toBe(first.id)
  expect((await ok(A,'Parent','GET','/suite/fees/ledger/'+A.student)).totals.outstanding).toBe(600)
  for(const role of ['Parent','Student','Teacher'])await denied(A,role,'POST','/suite/fees/concessions',{studentId:A.student,kind:'Percent',value:10,reason:'Not allowed'})
  for(const role of ['Parent','Student','Teacher'])await denied(A,role,'POST','/suite/fees/payments/'+first.id+'/reverse',{reason:'Not allowed here'})
  await denied(A,'Parent','PUT','/suite/fees/payment-config',{provider:'fake',onlineEnabled:true})
  await denied(A,'Administrator','GET','/suite/fees/receipts/'+randomUUID(),undefined,404)
  // Receipts: the family reads its own, never another school's; school B's office never sees school A's receipt.
  expect((await ok(A,'Student','GET','/suite/fees/receipts/'+first.id)).receipt.amount).toBe(400)
  await denied(B,'Administrator','GET','/suite/fees/receipts/'+first.id,undefined,404)
  // Online payments are off until the school turns them on; a provider event without a known attempt is refused.
  await denied(A,'Parent','POST','/suite/fees/online/intents',{chargeId:charge},409)
  // The webhook needs no EduOS session; the provider signature is the credential. An unknown order is refused as not found before any
  // signature can be checked (the order names the school whose secret would verify it), signed or not, and creates no financial state.
  const event=await api.post('/api/v1/fees/webhooks/fake',{headers:{'X-Signature':'deadbeef','Content-Type':'application/json'},data:{eventId:'evt_x',orderReference:'fake_none',amount:1,currency:'INR',status:'captured'}})
  expect(event.status()).toBe(404)
  const unsigned=await api.post('/api/v1/fees/webhooks/fake',{headers:{'Content-Type':'application/json'},data:{eventId:'evt_y',orderReference:'fake_none',amount:1,currency:'INR',status:'captured'}})
  expect(unsigned.status()).toBe(404)
  expect((await api.post('/api/v1/fees/webhooks/nope',{headers:{'Content-Type':'application/json'},data:{}})).status()).toBe(401)   // not a provider: no anonymous path exists for it
  expect((await ok(A,'Administrator','GET','/suite/fees/payments')).length).toBe(1)   // the one recorded payment; the events created nothing
 })

 test('Student 360 shows a student only to the office, the class teacher and the linked family',async()=>{
  // Own scope: the student themself, the linked parent, the class teacher and the office all read the composed picture.
  for(const role of ['Student','Parent','Teacher','Administrator'])expect((await ok(A,role,'GET','/suite/students/'+A.student+'/360')).student.id).toBe(A.student)
  const teacherView=await ok(A,'Teacher','GET','/suite/students/'+A.student+'/360')
  expect(teacherView.fees.available).toBe(false);expect(teacherView.student.email).toBe('');expect(teacherView.visibility.contact).toBe(false)     // fees and contact details stay with the office and the family
  const parentView=await ok(A,'Parent','GET','/suite/students/'+A.student+'/360')
  expect(parentView.fees.available).toBe(true);expect(parentView.visibility.contact).toBe(true);expect(parentView.exams.published).toBe(0)        // nothing unpublished is counted
  expect((await ok(A,'Student','GET','/suite/students/'+A.student+'/360/timeline?page=1&pageSize=5')).pageSize).toBe(5)
  // Another student, an unrelated child, a student outside the teacher's classes: refused before any lookup, so the
  // same 403 whether the id is in this school or another, and nothing is learnt from it.
  for(const role of ['Student','Parent','Teacher']){await denied(A,role,'GET','/suite/students/'+B.student+'/360');await denied(A,role,'GET','/suite/students/'+randomUUID()+'/360');await denied(A,role,'GET','/suite/students/'+B.student+'/360/timeline')}
  // The office of school A cannot reach a student of school B: not found, never another school's record.
  await denied(A,'Administrator','GET','/suite/students/'+B.student+'/360',undefined,404);await denied(A,'Administrator','GET','/suite/students/'+B.student+'/360/timeline',undefined,404)
  // Writes do not exist for Student 360, whatever the role.
  for(const role of ['Administrator','Teacher','Parent','Student'])await denied(A,role,'POST','/suite/students/'+A.student+'/360',{})
 })

 test('teacher, parent and student are refused every administrative operation',async()=>{
  const catalog=await ok(A,'Administrator','GET','/suite/catalog')
  const refs={'academic-years':A.year,classes:A.cl,subjects:A.subject,'assessment-schemes':A.scheme,'fee-heads':A.head,teachers:A.teacher,students:A.student,users:A.users.Student,'period-slots':A.slot,timetable:A.period,'leave-types':A.leaveType,'leave-requests':A.leave}
  // Modules whose references can all be satisfied with school A records; anything else would fail field validation first.
  const modules=catalog.filter((m:any)=>!m.fields.some((f:any)=>f.type==='reference'&&!(f.source in refs)))
  expect(modules.map((m:any)=>m.kind)).toEqual(expect.arrayContaining(['school-config','fee-heads','fee-structures','academic-years','classes','subjects','teaching-assignments','assessment-schemes','exams','timetable','period-slots','substitutions','leave-types','leave-requests','leave-adjustments','circulars','calendar','certificates','account-links','admissions']))
  const teacherWritable=['leave-requests','marks','messages','homework','submissions']
  for(const role of lower){
   for(const m of modules){
    if(m.kind==='submissions'||(role==='Teacher'&&teacherWritable.includes(m.kind)))continue
    await denied(A,role,'POST','/suite/records/'+m.kind,sample(m.fields,refs))
   }
   for(const kind of ['admissions','account-links','fee-heads','fee-structures','school-config'])await denied(A,role,'GET','/suite/records/'+kind)
   await denied(A,role,'PUT','/suite/records/circulars/'+A.circular,{title:'Changed',message:'x',audience:'All',dueDate:day,version:1})
   await denied(A,role,'DELETE','/suite/records/circulars/'+A.circular)
   await denied(A,role,'POST','/suite/admissions/'+A.admission+'/accept')
   await denied(A,role,'POST','/suite/allocate',{studentIds:[A.student],classId:A.cl})
   await denied(A,role,'POST','/suite/fees/charges',{studentId:A.student,structureId:randomUUID(),concession:'0'})
   await denied(A,role,'POST','/suite/fees/payments',{idempotencyKey:randomUUID(),chargeId:randomUUID(),amount:'10',method:'Cash',reference:'',paidOn:day})
   await denied(A,role,'POST','/suite/fees/'+randomUUID()+'/remind')
   await denied(A,role,'POST','/suite/absence-notifications',{day})
   await denied(A,role,'POST','/suite/imports/students',{rows:[{}],commit:false})
   await denied(A,role,'GET','/suite/reports/admissions');await denied(A,role,'GET','/suite/reports/audit')
   await denied(A,role,'GET','/suite/circulars/'+A.circular+'/acknowledgements')
   await denied(A,role,'GET','/suite/documents/'+A.document);await denied(A,role,'GET','/suite/documents?recordId='+A.admission)
   await denied(A,role,'GET','/users');await denied(A,role,'POST','/users',{roleId:randomUUID(),username:'x',email:'x@example.test',firstName:'x',lastName:'x',password})
   await denied(A,role,'PUT','/users/'+A.users.Student,{isActive:false});await denied(A,role,'DELETE','/users/'+A.users.Student)
   await denied(A,role,'POST','/users/'+A.users.Student+'/recovery-code');await denied(A,role,'GET','/roles')
   await denied(A,role,'GET','/students');await denied(A,role,'POST','/students',{});await denied(A,role,'DELETE','/students/'+A.student)
   await denied(A,role,'GET','/teachers');await denied(A,role,'DELETE','/teachers/'+A.teacher);await denied(A,role,'GET','/parents')
   await denied(A,role,'GET','/schools/'+A.id);await denied(A,role,'PUT','/schools/'+A.id,{name:'Renamed'})
   await denied(A,role,'GET','/operations/overview?day='+day);await denied(A,role,'POST','/operations/announcements',{title:'x',body:'x',priority:'Normal'});await denied(A,role,'GET','/operations/audit')
  }
  await denied(A,'Teacher','GET','/suite/fees')
  await denied(A,'Student','GET','/suite/student-attendance?day='+day);await denied(A,'Parent','GET','/suite/student-attendance?day='+day)
  await ok(A,'Teacher','GET','/suite/student-attendance?day='+day)
 })

 test('spoofed X-EduOS headers and school scope cannot raise access',async()=>{
  const spoof={'X-EduOS-Role':'Administrator','X-EduOS-User':A.adminId,'X-EduOS-School':B.id}
  await denied(A,'Student','GET','/suite/records/admissions',undefined,403,spoof)
  await denied(A,'Student','GET','/users',undefined,403,spoof)
  await denied(A,'Student','GET','/suite/catalog?schoolId='+B.id,undefined,403,spoof)
  await denied(A,'Student','POST','/suite/records/submissions',{homeworkId:B.homework,studentId:B.student,response:'x',schoolId:B.id},403,spoof)
  await denied(A,'Administrator','GET','/schools/'+B.id,undefined,403,spoof)
  await denied(A,'Administrator','POST','/students',{schoolId:B.id,rollNumber:'X',firstName:'X',lastName:'X',email:'x@example.test',currentClass:'X',dateOfBirth:'2014-01-01'},403,spoof)
 })

 test('school A cannot read, change or link school B objects by id',async()=>{
  const teacherBody={id:B.teacher,firstName:'Moved',lastName:'Teacher',email:'moved-'+A.id+'@example.test',phoneNumber:'9000000009',department:'Science',status:'Active'}
  const studentBody={id:B.student,firstName:'Moved',lastName:'Student',email:'moved-s-'+A.id+'@example.test',currentClass:'Grade 7 - A',dateOfBirth:'2014-05-01T00:00:00Z',status:'Active'}
  await denied(A,'Administrator','PUT','/students/'+B.student,studentBody,404);await denied(A,'Administrator','DELETE','/students/'+B.student,undefined,404)
  await denied(A,'Administrator','PUT','/teachers/'+B.teacher,teacherBody,404);await denied(A,'Administrator','DELETE','/teachers/'+B.teacher,undefined,404)
  await denied(A,'Administrator','PUT','/suite/records/circulars/'+B.circular,{title:'Hijacked',message:'x',audience:'All',dueDate:day,version:1},404)
  await denied(A,'Administrator','DELETE','/suite/records/circulars/'+B.circular,undefined,404)
  await denied(A,'Administrator','POST','/suite/admissions/'+B.admission+'/accept',undefined,404)
  await denied(A,'Administrator','GET','/suite/documents/'+B.document,undefined,404);await denied(A,'Administrator','GET','/suite/documents?recordId='+B.admission,undefined,404)
  await denied(A,'Administrator','GET','/suite/report-cards/'+B.student,undefined,404);await denied(A,'Parent','GET','/suite/report-cards/'+B.student,undefined,403)
  await denied(A,'Administrator','GET','/suite/certificates/'+B.certificate+'/print',undefined,404)
  await denied(A,'Administrator','POST','/suite/circulars/'+B.circular+'/acknowledge',undefined,404);await denied(A,'Student','POST','/suite/circulars/'+B.circular+'/acknowledge',undefined,404)
  await denied(A,'Administrator','GET','/suite/circulars/'+B.circular+'/acknowledgements',undefined,404)
  await denied(A,'Administrator','POST','/suite/allocate',{studentIds:[B.student],classId:A.cl},400)
  await denied(A,'Administrator','POST','/suite/allocate',{studentIds:[A.student],classId:B.cl},404)
  await denied(A,'Administrator','POST','/suite/student-attendance',{day,entries:[{studentId:B.student,status:'Present'}]},403)
  await denied(A,'Administrator','POST','/operations/attendance',{day,entries:[{studentId:B.student,status:'Present'}]},400)
  await denied(A,'Administrator','POST','/suite/records/account-links',{userId:B.users.Student,studentId:A.student},400)
  // References into another school's Suite records resolve as "not found in this school"; external tables answer 400.
  await denied(A,'Administrator','POST','/suite/records/homework',{title:'Cross',classId:B.cl,subjectId:A.subject,dueDate:day,instructions:'x'},404)
  await denied(A,'Student','POST','/suite/records/submissions',{homeworkId:B.homework,studentId:B.student,response:'x'},404)
  await denied(A,'Administrator','PUT','/users/'+B.users.Teacher,{isActive:false},404);await denied(A,'Administrator','DELETE','/users/'+B.users.Teacher,undefined,404)
  await denied(A,'Administrator','POST','/users/'+B.users.Teacher+'/recovery-code',undefined,404)
  // School B is untouched by all of the above.
  expect((await ok(B,'Administrator','GET','/suite/records/circulars')).data[0].title).toBe('Notice b')
  expect((await ok(B,'Administrator','GET','/students/count')).count).toBe(1)
  expect((await ok(B,'Administrator','GET','/suite/allocations'))[0].classId).toBe(B.cl)
  expect((await ok(B,'Administrator','GET','/users')).data.map((u:any)=>u.isActive)).toEqual([true,true,true,true])
 })

 test('communications stay inside the school and the family',async()=>{
  // A draft of school A: unknown to school B by id, and to every role of A that does not manage communications.
  const aDraft=(await ok(A,'Administrator','POST','/suite/records/circulars',{title:'Draft a',message:'Not yet.',audience:'All',status:'Draft'},201)).id
  await denied(B,'Administrator','GET','/suite/communications/'+aDraft,undefined,404)
  await denied(B,'Administrator','GET','/suite/communications/'+aDraft+'/acknowledgements',undefined,404)
  for(const action of ['publish','schedule','cancel','archive'])await denied(B,'Administrator','POST','/suite/communications/'+aDraft+'/'+action,{version:1,reason:'x',publishAt:'2030-01-01T09:00:00Z'},404)
  await denied(B,'Administrator','PUT','/suite/records/circulars/'+aDraft,{title:'Hijacked',message:'x',audience:'All',status:'Published',version:1},404)
  // School B's class cannot be an audience of school A, and B's communications cannot be read, marked read or acknowledged from A.
  await denied(A,'Administrator','POST','/suite/records/circulars',{title:'Cross',message:'x',audience:'Parent',classId:B.cl,status:'Published'},404)
  await denied(A,'Administrator','POST','/suite/communications/audience',{audience:'Parent',classId:B.cl},404)
  await denied(A,'Administrator','GET','/suite/communications/'+B.circular,undefined,404)
  await denied(A,'Administrator','GET','/suite/communications/'+B.circular+'/acknowledgements',undefined,404)
  await denied(A,'Administrator','POST','/suite/communications/'+B.circular+'/archive',{version:1},404)
  await denied(A,'Parent','POST','/suite/communications/'+B.circular+'/read',undefined,404)
  await denied(A,'Parent','POST','/suite/circulars/'+B.circular+'/acknowledge',undefined,404)
  expect((await ok(A,'Parent','GET','/suite/communications/feed')).items.map((i:any)=>i.id)).toEqual([A.circular])
  expect(JSON.stringify(await ok(B,'Administrator','GET','/suite/communications'))).not.toContain('Draft a')
  expect(JSON.stringify(await ok(A,'Administrator','GET','/suite/communications/attention'))).not.toContain('Notice b')
  // Within school A: teacher, parent and student hold no administrative communication capability; a parent cannot see a draft by any route.
  for(const role of lower){
   await denied(A,role,'GET','/suite/communications');await denied(A,role,'GET','/suite/communications/attention');await denied(A,role,'GET','/suite/communications/'+aDraft)
   await denied(A,role,'POST','/suite/communications/audience',{audience:'All'});await denied(A,role,'POST','/suite/communications/'+A.circular+'/archive',{version:1})
   await denied(A,role,'POST','/suite/communications/'+aDraft+'/publish',{version:1});await denied(A,role,'POST','/suite/communications/'+aDraft+'/read',undefined,404)
   expect((await ok(A,role,'GET','/suite/communications/feed')).items.map((i:any)=>i.id)).toEqual([A.circular])
  }
  // The family boundary: school B's parent sees only B's communication and cannot touch A's; nobody acknowledges for anyone else.
  await login(B,'Parent')
  expect((await ok(B,'Parent','GET','/suite/communications/feed')).items.map((i:any)=>i.id)).toEqual([B.circular])
  await denied(B,'Parent','POST','/suite/communications/'+A.circular+'/read',undefined,404);await denied(B,'Parent','POST','/suite/circulars/'+A.circular+'/acknowledge',undefined,404)
  await ok(B,'Parent','POST','/suite/circulars/'+B.circular+'/acknowledge')
  expect((await ok(A,'Administrator','GET','/suite/circulars/'+A.circular+'/acknowledgements')).map((r:any)=>r.name)).not.toContain('Parent QA b')
  const inboxA=await ok(A,'Parent','GET','/notifications');expect(inboxA.items.some((i:any)=>i.destination?.entityId===B.circular)).toBe(false)
  await denied(A,'Parent','POST','/notifications/'+randomUUID()+'/read',undefined,404)
  // School A's draft never became visible or sent while being refused everywhere above.
  expect((await ok(A,'Administrator','GET','/suite/communications/'+aDraft)).status).toBe('Draft')
  expect(sql("SELECT 'n='||count(*) FROM notify.notifications WHERE school_id='"+A.id+"' AND event_key='circular.published:"+aDraft+"'")).toContain('n=0')
 })

 test('disable and delete end sessions and refresh cannot resurrect them after re-enable',async()=>{
  const before=A.tokens.Teacher
  await ok(A,'Teacher','GET','/suite/catalog')
  await ok(A,'Administrator','PUT','/users/'+A.users.Teacher,{isActive:false})
  await denied(A,'Teacher','GET','/suite/catalog',undefined,401)
  // No refresh attempt while disabled: that path revokes the token on its own. The regression is a refresh token
  // issued before the disable resuming the session once the account is re-enabled.
  await ok(A,'Administrator','PUT','/users/'+A.users.Teacher,{isActive:true})
  await denied(A,'Teacher','GET','/suite/catalog',undefined,401)
  expect((await api.post('/api/v1/auth/refresh',{data:{refreshToken:before.refreshToken}})).status()).toBe(401)
  await login(A,'Teacher');await ok(A,'Teacher','GET','/suite/catalog')
  const roles=await ok(A,'Administrator','GET','/roles')
  const temp=(await ok(A,'Administrator','POST','/users',{schoolId:A.id,roleId:roles.find((r:any)=>r.name==='Principal').id,username:username(A,'Temp'),email:'temp-'+A.id+'@example.test',firstName:'Temp',lastName:'Principal',password},201)).id
  await login(A,'Temp');await ok(A,'Temp','GET','/students')
  await ok(A,'Administrator','DELETE','/users/'+temp)
  await denied(A,'Temp','GET','/students',undefined,401)
  expect((await api.post('/api/v1/auth/refresh',{data:{refreshToken:A.tokens.Temp.refreshToken}})).status()).toBe(401)
  expect((await loginRequest({schoolId:A.id,username:username(A,'Temp'),password})).status()).toBe(401)
 })

 test('only health, login, refresh and reset-password are reachable without a bearer',async()=>{
  expect((await api.get('/api/v1/health')).status()).toBe(200)
  expect((await loginRequest({schoolId:A.id,username:'nobody',password:'wrong-password-long-enough'})).status()).toBe(401)
  expect((await api.post('/api/v1/auth/refresh',{data:{refreshToken:'stale'}})).status()).toBe(401)
  expect((await throttled(()=>api.post('/api/v1/auth/reset-password',{data:{code:'short',password:'not-long-enough'}}))).status()).toBe(400)
  for(const url of ['/auth/logout','/roles','/users','/students','/teachers','/parents','/schools/'+A.id,'/operations/overview?day='+day,'/suite/catalog','/suite/records/circulars','/suite/documents/'+A.document])
   expect((await api.fetch('/api/v1'+url,{method:url==='/auth/logout'?'POST':'GET'})).status(),url).toBe(401)
  expect((await api.get('/api/v1/suite/catalog',{headers:{Authorization:'Bearer not.a.token'}})).status()).toBe(401)
 })

 test('internal services and the database are not reachable from the host',async()=>{
  // Other applications may use these host ports; inspect only this Compose project's containers.
  for(const service of ['api-gateway','auth-service','student-service','teacher-service','parent-service','school-service','ai-service','postgres','ai-db']){
   const ids=execFileSync('docker',['compose','--profile','ai','ps','-q',service],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean)
   expect(ids.length,service+' must be running').toBeGreaterThan(0)
   for(const id of ids){const bindings=JSON.parse(execFileSync('docker',['inspect',id,'--format','{{json .HostConfig.PortBindings}}'],{cwd:root,encoding:'utf8'}));expect(Object.keys(bindings||{}),service+' must not publish internal ports').toEqual([])}
  }
 })
 test('free notification live delivery, preferences and tenant isolation',async({page})=>{
  const {HubConnectionBuilder,HttpTransportType,LogLevel}=await import('@microsoft/signalr')
  const base=process.env.EDUOS_TEST_URL||'http://localhost:8081'
  const received:Record<string,any[]>={parent:[],student:[],other:[]}
  const connections=[['parent',A,'Parent'],['student',A,'Student'],['other',B,'Administrator']].map(([name,school,role]:any[])=>{
   const hub=new HubConnectionBuilder().withUrl(base+'/api/v1/notifications/live',{transport:HttpTransportType.LongPolling,accessTokenFactory:()=>school.tokens[role].accessToken}).configureLogging(LogLevel.None).build()
   hub.on('NotificationsChanged',event=>received[name].push(event));return hub
  })
  try{
   expect((await api.post('/api/v1/notifications/live/negotiate?negotiateVersion=1')).status()).toBe(401)
   await Promise.all(connections.map(h=>h.start()))
   await expect(connections[1].invoke('JoinGroup','school:'+A.id+':user:'+A.users.Parent)).rejects.toThrow()
   await page.addInitScript(tokens=>{localStorage.setItem('accessToken',tokens.accessToken);localStorage.setItem('refreshToken',tokens.refreshToken);localStorage.setItem('user',JSON.stringify(tokens.user))},A.tokens.Parent)
   await page.goto(base+'/notifications')
   await expect(page.locator('.notification-toasts')).toHaveAttribute('data-live-state','connected')
   await page.getByText('Notification preferences',{exact:true}).click()
   const notices=page.getByRole('checkbox',{name:'Notices',exact:true})
   const setNotices=async(enabled:boolean)=>{const saved=page.waitForResponse(r=>r.url().endsWith('/notifications/preferences')&&r.request().method()==='PUT');await notices.click();expect((await saved).status()).toBe(200);await expect(notices).toBeChecked({checked:enabled});await expect(notices).toBeEnabled()}
   await setNotices(false)
   const muted='Muted QA '+randomUUID(),live='Live QA '+randomUUID()
   const publish=(title:string)=>ok(A,'Administrator','POST','/suite/records/circulars',{title,message:'Isolated notification test.',audience:'Parent',classId:A.cl,status:'Published'},201)
   await publish(muted)
   expect((await ok(A,'Parent','GET','/notifications')).items.some((x:any)=>x.title.includes(muted))).toBe(false)
   await setNotices(true)
   await publish(live)
   await expect(page.locator('.notification-toast')).toContainText(live)
   await expect.poll(()=>received.parent.length).toBeGreaterThan(0)
   const item=(await ok(A,'Parent','GET','/notifications')).items.find((x:any)=>x.title.includes(live))
   expect(item).toBeTruthy()
   expect(received.parent.some(x=>x.id===item.id)).toBe(true)
   expect(received.parent.every(x=>Object.keys(x).join(',')==='id')).toBe(true)
   expect(received.student.some(x=>x.id===item.id)).toBe(false)
   expect(received.other.some(x=>x.id===item.id)).toBe(false)
   for(const [school,role] of [[A,'Student'],[B,'Administrator']] as const)expect((await ok(school,role,'GET','/notifications')).items.some((x:any)=>x.id===item.id)).toBe(false)
   await ok(A,'Parent','POST','/notifications/'+item.id+'/read')
   await expect.poll(()=>received.parent.some(x=>x.id===null)).toBe(true)
   await page.context().grantPermissions(['notifications'],{origin:base})
   await page.getByRole('checkbox',{name:'Allow browser alerts on this device'}).click()
   await expect(page.getByRole('checkbox',{name:'Allow browser alerts on this device'})).toBeChecked()
   expect(await page.evaluate(({school,user})=>localStorage.getItem('eduos.browser-alerts.'+school+'.'+user),{school:A.id,user:A.users.Parent})).toBe('1')
  }finally{await Promise.all(connections.map(h=>h.stop()))}
 })

 test('school notification delivery settings enforce permission, isolation and audit',async({page})=>{
  const key='circular.published',url='/notifications/settings/'+key
  for(const role of lower){await denied(A,role,'GET','/notifications/settings');await denied(A,role,'GET','/notifications/settings/history');await denied(A,role,'PUT',url,{enabled:false,version:0,confirmRisk:true})}
  await denied(A,'Administrator','PUT',url,{enabled:false,version:0},409)
  await denied(A,'Administrator','PUT','/notifications/settings/not-real',{enabled:false,version:0},404)
  const before=(await ok(A,'Parent','GET','/notifications')).items.map((x:any)=>x.id)
  await page.addInitScript(tokens=>{localStorage.setItem('accessToken',tokens.accessToken);localStorage.setItem('refreshToken',tokens.refreshToken);localStorage.setItem('user',JSON.stringify(tokens.user))},A.tokens.Administrator)
  await page.goto('/notifications/settings')
  const settings=await ok(A,'Administrator','GET','/notifications/settings'),name=settings.find((r:any)=>r.key===key).name
  const control=page.getByRole('switch',{name,exact:true})
  await expect(control).toHaveAttribute('aria-checked','true')
  await control.click()
  await expect(page.getByRole('alert')).toContainText('Urgent notices')
  await page.getByRole('button',{name:'Confirm disable',exact:true}).click()
  await expect(control).toHaveAttribute('aria-checked','false')
  await denied(A,'Administrator','PUT',url,{enabled:true,version:0},409)
  const quiet='Disabled school alert '+randomUUID()
  await ok(A,'Administrator','POST','/suite/records/circulars',{title:quiet,message:'Still available as a communication.',audience:'Parent',classId:A.cl,status:'Published',priority:'Urgent'},201)
  expect((await ok(A,'Parent','GET','/notifications')).items.map((x:any)=>x.id)).toEqual(before)
  expect((await ok(B,'Administrator','GET','/notifications/settings')).find((r:any)=>r.key===key).enabled).toBe(true)
  expect(await ok(B,'Administrator','GET','/notifications/settings/history')).toEqual([])
  await control.click();await expect(control).toHaveAttribute('aria-checked','true')
  const live='Enabled school alert '+randomUUID()
  await ok(A,'Administrator','POST','/suite/records/circulars',{title:live,message:'Delivery resumed.',audience:'Parent',classId:A.cl,status:'Published'},201)
  expect((await ok(A,'Parent','GET','/notifications')).items.some((x:any)=>x.title.includes(live))).toBe(true)
  const changes=await ok(A,'Administrator','GET','/notifications/settings/history')
  expect(changes.map((x:any)=>x.enabled)).toEqual([true,false]);expect(changes.every((x:any)=>x.actor==='Security Admin'&&x.type===key)).toBe(true)
  await expect(page.getByText('Recent delivery changes',{exact:true})).toBeVisible()
  await page.setViewportSize({width:390,height:844})
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 })

 test('school timezone scheduling, rescheduling, cancellation and automatic publication',async({page})=>{
  for(const role of ['Parent','Student'])await denied(A,role,'GET','/suite/communications/config')
  await denied(A,'Administrator','PUT','/suite/communications/config',{timeZone:'invalid/zone'},400)
  await ok(A,'Administrator','PUT','/suite/communications/config',{timeZone:'Asia/Kolkata'})
  expect((await ok(B,'Administrator','GET','/suite/communications/config')).timeZone).toBe('UTC')
  await page.addInitScript(tokens=>{localStorage.setItem('accessToken',tokens.accessToken);localStorage.setItem('refreshToken',tokens.refreshToken);localStorage.setItem('user',JSON.stringify(tokens.user))},A.tokens.Administrator)
  await page.goto('/suite/communications')
  await page.getByRole('button',{name:'New communication',exact:true}).click()
  const date=new Date(Date.now()+172800000).toISOString().slice(0,10)
  const dialog=page.getByRole('dialog'),title='Schedule QA '+randomUUID()
  await dialog.getByLabel('Title',{exact:true}).fill(title);await dialog.getByLabel('Message',{exact:true}).fill('A scheduled school announcement.')
  await dialog.getByRole('button',{name:'Next',exact:true}).click()
  await dialog.getByLabel('Audience',{exact:true}).selectOption('Parent');await dialog.getByLabel('Class',{exact:true}).selectOption(A.cl)
  await dialog.getByRole('button',{name:'Next',exact:true}).click()
  await dialog.getByRole('radio',{name:'Schedule for later'}).check()
  await dialog.getByLabel('Publish at (Asia/Kolkata)',{exact:true}).fill(date+'T09:00')
  await dialog.getByRole('button',{name:'Next',exact:true}).click()
  await expect(dialog).toContainText('1 people');await expect(dialog).toContainText('Asia/Kolkata')
  await dialog.getByRole('button',{name:'Schedule',exact:true}).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/id=[0-9a-f-]{36}/)
  await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible()
  const id=new URL(page.url()).searchParams.get('id')!
  let item=await ok(A,'Administrator','GET','/suite/communications/'+id)
  expect(new Date(item.publishAt).toISOString()).toBe(date+'T03:30:00.000Z')
  expect((await ok(A,'Parent','GET','/suite/communications/feed')).items.some((x:any)=>x.id===id)).toBe(false)
  await page.getByRole('button',{name:'Change time',exact:true}).click()
  await dialog.getByLabel('Publish at (Asia/Kolkata)',{exact:true}).fill(date+'T10:00')
  await dialog.getByRole('button',{name:'Change time',exact:true}).click()
  await expect(dialog).toHaveCount(0)
  item=await ok(A,'Administrator','GET','/suite/communications/'+id)
  expect(new Date(item.publishAt).toISOString()).toBe(date+'T04:30:00.000Z')
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.getByLabel('Reason',{exact:true}).fill('QA cancellation')
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0)
  expect((await ok(A,'Administrator','GET','/suite/communications/'+id)).status).toBe('Cancelled')
  const automatic=(await ok(A,'Administrator','POST','/suite/records/circulars',{title:'Automatic '+title,message:'Worker publication.',audience:'Parent',classId:A.cl,status:'Scheduled',publishAt:new Date(Date.now()+5000).toISOString()},201)).id
  await expect.poll(async()=>(await ok(A,'Administrator','GET','/suite/communications/'+automatic)).status,{timeout:45000,intervals:[1000,2000]}).toBe('Published')
  await expect.poll(async()=>(await ok(A,'Parent','GET','/notifications')).items.filter((x:any)=>x.destination?.entityId===automatic).length).toBe(1)
  expect((await ok(B,'Administrator','GET','/notifications')).items.some((x:any)=>x.destination?.entityId===automatic)).toBe(false)
 })

 test('inbox notice acknowledgement is scoped, confirmed and idempotent',async({page})=>{
  const title='Acknowledge QA '+randomUUID(),message='Read the full school notice before confirming.'
  const notice=(await ok(A,'Administrator','POST','/suite/records/circulars',{title,message,audience:'Parent',classId:A.cl,status:'Published',requiresAcknowledgement:'Yes'},201)).id
  const item=(await ok(A,'Parent','GET','/notifications')).items.find((x:any)=>x.destination?.entityId===notice)
  expect(item.requiresAcknowledgement).toBe(true);expect(item.acknowledgedAt).toBeNull()
  await denied(B,'Administrator','GET','/notifications/'+item.id+'/notice',undefined,404)
  await denied(A,'Student','GET','/notifications/'+item.id+'/notice',undefined,404)
  expect((await ok(A,'Parent','GET','/notifications/'+item.id+'/notice')).message).toBe(message)
  await page.addInitScript(tokens=>{localStorage.setItem('accessToken',tokens.accessToken);localStorage.setItem('refreshToken',tokens.refreshToken);localStorage.setItem('user',JSON.stringify(tokens.user))},A.tokens.Parent)
  let posts=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/circulars/'+notice+'/acknowledge'))posts++})
  await page.goto('/notifications')
  const row=page.locator('.inbox-list>li').filter({hasText:title}),dialog=page.getByRole('dialog')
  await row.getByRole('button',{name:'Review & acknowledge',exact:true}).click()
  await expect(dialog).toContainText(message)
  await page.setViewportSize({width:390,height:844})
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  expect(posts).toBe(0)
  await dialog.getByRole('button',{name:'Confirm acknowledgement',exact:true}).click()
  await expect(dialog.getByRole('status')).toContainText('Acknowledged')
  await expect(dialog.getByRole('button',{name:'Confirm acknowledgement',exact:true})).toHaveCount(0)
  expect(posts).toBe(1)
  await dialog.getByRole('button',{name:'Close',exact:true}).click()
  await expect(row).toContainText('Acknowledged')
  await page.reload();await expect(page.locator('.inbox-list>li').filter({hasText:title})).toContainText('Acknowledged')
  await ok(A,'Parent','POST','/suite/circulars/'+notice+'/acknowledge')
  const tracking=await ok(A,'Administrator','GET','/suite/communications/'+notice+'/acknowledgements')
  expect(tracking.acknowledged.filter((x:any)=>x.name==='Parent QA')).toHaveLength(1)
  // A newly signed-in account with read access but no acknowledgement grant can review, never confirm.
  sql("DELETE FROM auth_db.role_permissions WHERE role_id=(SELECT role_id FROM auth_db.users WHERE id='"+A.users.Parent+"') AND permission_key='circulars.acknowledge'")
  const originalTokens=A.tokens.Parent
  try{
   await login(A,'Parent')
   expect((await ok(A,'Parent','GET','/notifications/'+item.id+'/notice')).canAcknowledge).toBe(false)
   await denied(A,'Parent','POST','/suite/circulars/'+notice+'/acknowledge')
  }finally{
   sql("INSERT INTO auth_db.role_permissions(id,role_id,permission_key) SELECT gen_random_uuid(),role_id,'circulars.acknowledge' FROM auth_db.users WHERE id='"+A.users.Parent+"' ON CONFLICT DO NOTHING")
   A.tokens.Parent=originalTokens
  }
 })

 test('student setup creates one profile or links an existing record and connects class and parent',async({page})=>{
  page.setDefaultTimeout(15000)
  const roles=await ok(A,'Administrator','GET','/roles'),studentRole=roles.find((r:any)=>r.name==='Student').id
  const createAccount=async(email:string)=>(await ok(A,'Administrator','POST','/users',{schoolId:A.id,roleId:studentRole,username:email,email,firstName:'Setup',lastName:'Learner',password},201)).id
  const email='setup-'+randomUUID()+'@example.test',account=await createAccount(email)
  for(const role of lower){await denied(A,role,'GET','/suite/student-setup/'+account);await denied(A,role,'POST','/suite/student-setup/'+account,{mode:'new'})}
  await denied(B,'Administrator','GET','/suite/student-setup/'+account,undefined,404)
  await denied(A,'Administrator','POST','/suite/student-setup/'+account,{mode:'existing',studentId:B.student,verified:true},400)
  await page.addInitScript(tokens=>{localStorage.setItem('accessToken',tokens.accessToken);localStorage.setItem('refreshToken',tokens.refreshToken);localStorage.setItem('user',JSON.stringify(tokens.user))},A.tokens.Administrator)
  await page.goto('/control/users')
  await page.getByRole('searchbox',{name:'Search accounts',exact:true}).fill(email)
  const row=page.locator('tbody tr').filter({hasText:email});await row.getByRole('button',{name:'Complete student setup',exact:true}).click()
  const dialog=page.getByRole('dialog')
  await dialog.getByRole('radio',{name:'Create missing student profile',exact:true}).check()
  await dialog.getByLabel('Date of birth',{exact:true}).fill('2014-05-01');await dialog.getByLabel('Gender',{exact:true}).selectOption('Female')
  await dialog.getByLabel('Class and section',{exact:true}).selectOption(A.cl)
  await dialog.getByLabel('Guardian connection',{exact:true}).selectOption('new')
  await dialog.getByLabel('Guardian first name',{exact:true}).fill('Parent');await dialog.getByLabel('Guardian last name',{exact:true}).fill('QA')
  const parentEmail='parent-'+A.id+'@example.test'
  await dialog.getByLabel('Guardian email',{exact:true}).fill(parentEmail)
  await dialog.getByRole('checkbox',{name:"I verified this guardian's relationship to the student.",exact:true}).check()
  await dialog.getByLabel('Parent login',{exact:true}).selectOption(A.users.Parent)
  await dialog.getByRole('button',{name:'Review connections',exact:true}).click()
  await expect(dialog).toContainText('Existing login')
  await dialog.getByRole('button',{name:'Save connections',exact:true}).click();await expect(dialog).toHaveCount(0)
  const saved=await ok(A,'Administrator','GET','/suite/student-setup/'+account),profile=saved.students.find((s:any)=>s.id===saved.linkedStudentId)
  expect(profile.email).toBe(email);expect(profile.classId).toBe(A.cl);expect(profile.guardianId).toBeTruthy()
  const repeated=await ok(A,'Administrator','POST','/suite/student-setup/'+account,{mode:'new'})
  expect(repeated.alreadyLinked).toBe(true)
  expect((await ok(A,'Administrator','GET','/suite/student-setup/'+account)).students.filter((s:any)=>s.email===email)).toHaveLength(1)
  await login(A,'Parent')
  expect((await ok(A,'Parent','GET','/suite/options')).students.some((s:any)=>s.id===profile.id)).toBe(true)
  const email2='existing-'+randomUUID()+'@example.test',account2=await createAccount(email2)
  const existing=(await ok(A,'Administrator','POST','/students',{schoolId:A.id,rollNumber:'LINK-'+randomUUID().slice(0,8),firstName:'Existing',lastName:'Learner',email:email2,currentClass:'Unallocated',dateOfBirth:'2013-03-02T00:00:00Z'},201)).id
  await denied(A,'Administrator','POST','/suite/student-setup/'+account2,{mode:'new',dateOfBirth:'2013-03-02',gender:'Male',guardianMode:'keep'},409)
  await page.goto('/control/users');await page.getByRole('searchbox',{name:'Search accounts',exact:true}).fill(email2)
  await page.locator('tbody tr').filter({hasText:email2}).getByRole('button',{name:'Complete student setup',exact:true}).click()
  await expect(dialog.getByRole('radio',{name:'Link existing student',exact:true})).toBeChecked()
  await expect(dialog.getByLabel('Existing student',{exact:true})).toHaveValue(existing)
  await dialog.getByRole('checkbox',{name:'I verified this record belongs to this student account.',exact:true}).check()
  await dialog.getByLabel('Class and section',{exact:true}).selectOption(A.cl)
  const existingGuardian=saved.parents.find((p:any)=>p.email==='kiran-'+A.id+'@example.test')
  await dialog.getByLabel('Guardian connection',{exact:true}).selectOption('existing');await dialog.getByLabel('Existing guardian',{exact:true}).selectOption(existingGuardian.id)
  await dialog.getByRole('checkbox',{name:"I verified this guardian's relationship to the student.",exact:true}).check()
  await dialog.getByRole('button',{name:'Create parent login',exact:true}).click()
  await expect(dialog.getByRole('status')).toContainText('Parent one-time recovery code')
  const newParentId=await dialog.getByLabel('Parent login',{exact:true}).inputValue();expect(newParentId).not.toBe('')
  await dialog.getByRole('button',{name:'Review connections',exact:true}).click();await dialog.getByRole('button',{name:'Save connections',exact:true}).click();await expect(dialog).toHaveCount(0)
  const linked=await ok(A,'Administrator','GET','/suite/student-setup/'+account2)
  expect(linked.parentLinks.some((l:any)=>l.userId===newParentId&&l.studentId===existing)).toBe(true)
  expect(linked.linkedStudentId).toBe(existing);expect(linked.students.filter((s:any)=>s.email===email2)).toHaveLength(1)
  expect(linked.students.find((s:any)=>s.id===existing).name).toBe('Existing Learner')
  await denied(A,'Administrator','POST','/suite/student-setup/'+account2,{mode:'existing',studentId:A.student,verified:true,guardianMode:'keep'},409)
 })

})
