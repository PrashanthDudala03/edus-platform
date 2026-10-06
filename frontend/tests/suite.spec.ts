import { seedIamSql, clearIamSql } from './iam-fixtures'
import {test,expect,APIRequestContext,APIResponse,Page} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {readFileSync,mkdirSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import path from 'node:path'
const root=path.resolve(import.meta.dirname,'../..')
const env=Object.fromEntries(readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(x=>x&&!x.startsWith('#')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)]}))
const schoolId=randomUUID(),adminId=randomUUID(),password=env.EDUOS_BOOTSTRAP_ADMIN_PASSWORD,day=new Date().toISOString().slice(0,10)
const sql=(query:string)=>execFileSync('docker',['compose','exec','-T','postgres','psql','-U',env.POSTGRES_USER,'-d',env.POSTGRES_DB,'-v','ON_ERROR_STOP=1','-c',query],{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe']})
let api:APIRequestContext,year='',cl='',subject='',teacher='',student='',admission='',charge='',exam='',homework='',submission='',certificate='',circular=''
const sessions:Record<string,any>={},users:Record<string,string>={},docs:string[]=[]
const headers=(role='Administrator')=>({Authorization:'Bearer '+sessions[role].accessToken})
const req=async(method:string,url:string,body?:any,role='Administrator')=>api.fetch('/api/v1'+url,{method,headers:headers(role),...(body===undefined?{}:{data:body})})
async function good(method:string,url:string,body?:any,role='Administrator',status=200){const r=await req(method,url,body,role);expect(r.status(),await r.text()).toBe(status);return(await r.json()).data}
const create=async(kind:string,body:any,role='Administrator')=>(await good('POST','/suite/records/'+kind,body,role,201)).id
const list=async(kind:string,role='Administrator')=>(await good('GET','/suite/records/'+kind,undefined,role)).data
// nginx limits login and reset-password to 10/min per client (burst 10); wait out a 429 when earlier specs used the budget.
async function throttled(send:()=>Promise<APIResponse>){for(let i=0;;i++){const r=await send();if(r.status()!==429||i>=15)return r;await new Promise(f=>setTimeout(f,6500))}}
async function login(role:string,pw=password){const r=await throttled(()=>api.post('/api/v1/auth/login',{data:{schoolId,username:'suite.'+role.toLowerCase(),password:pw}}));expect(r.status(),await r.text()).toBe(200);sessions[role]=(await r.json()).data}
async function browserSession(page:Page,role='Administrator'){await page.addInitScript(s=>{localStorage.setItem('accessToken',s.accessToken);localStorage.setItem('refreshToken',s.refreshToken);localStorage.setItem('user',JSON.stringify(s.user))},sessions[role])}
// Every module the suite serves, in catalog order. A new kind is a deliberate contract change: add it here with its feature.
const CATALOG=['academic-years','classes','subjects','teaching-assignments','admissions','admission-fields','staff-attendance','leave-types','leave-requests','leave-adjustments','fee-heads','fee-structures','assessment-schemes','exams','marks','circulars','calendar','messages','homework','submissions','period-slots','timetable','substitutions','certificates','account-links','school-config']
test.describe.serial('Complete school suite',()=>{
 test.beforeAll(async({playwright})=>{
  test.setTimeout(180000)
  const role=randomUUID()
  sql("BEGIN; INSERT INTO school_db.schools(id,name) VALUES('"+schoolId+"','Suite QA School'); INSERT INTO auth_db.roles(id,school_id,name) VALUES('"+role+"','"+schoolId+"','Administrator'); INSERT INTO auth_db.users(id,school_id,username,email,password_hash,first_name,last_name,role_id) SELECT '"+adminId+"','"+schoolId+"','suite.administrator','suite-"+schoolId+"@example.test',password_hash,'Suite','Admin','"+role+"' FROM auth_db.users WHERE school_id='"+env.EDUOS_BOOTSTRAP_SCHOOL_ID+"' AND username='"+env.EDUOS_BOOTSTRAP_ADMIN_USERNAME.replaceAll("'","''")+"'; "+['Principal','Teacher','Parent','Student'].map(r=>"INSERT INTO auth_db.roles(id,school_id,name) VALUES(gen_random_uuid(),'"+schoolId+"','"+r+"');").join(' ')+" COMMIT;")
  sql(seedIamSql(schoolId))
  api=await playwright.request.newContext({baseURL:process.env.EDUOS_TEST_URL||'http://localhost:8080'});await login('Administrator')
  const roles=await good('GET','/roles')
  for(const role of ['Principal','Teacher','Parent','Student']){
   users[role]=(await good('POST','/users',{schoolId,roleId:roles.find((r:any)=>r.name===role).id,username:'suite.'+role.toLowerCase(),email:role.toLowerCase()+schoolId+'@example.test',firstName:role,lastName:'QA',password},'Administrator',201)).id
   await login(role)
  }
 })
 test.afterAll(async()=>{
  await api?.dispose()
  const tables=['suite.documents','suite.acknowledgements','suite.payments','suite.charges','suite.student_classes','suite.records','suite.counters','school_db.attendance','student_db.students','teacher_db.teachers','parent_db.parents','school_db.announcements','auth_db.password_resets','auth_db.refresh_tokens','auth_db.users']
  sql("BEGIN; "+clearIamSql(schoolId)+tables.map(t=>"DELETE FROM "+t+" WHERE school_id='"+schoolId+"';").join(' ')+" DELETE FROM auth_db.role_permissions WHERE role_id IN(SELECT id FROM auth_db.roles WHERE school_id='"+schoolId+"'); DELETE FROM auth_db.roles WHERE school_id='"+schoolId+"'; DELETE FROM school_db.schools WHERE id='"+schoolId+"'; DELETE FROM school_db.audit_logs WHERE school_id='"+schoolId+"'; DELETE FROM suite.audit WHERE school_id='"+schoolId+"'; COMMIT;")
  for(const id of docs)execFileSync('docker',['compose','exec','-T','school-service','rm','--','/app/documents/'+id.replaceAll('-','')+'.bin'],{cwd:root,stdio:'pipe'})
 })
 test('sets up academics and admits a student once, with class and guardian records',async()=>{
  expect((await good('GET','/suite/catalog')).map((m:any)=>m.kind)).toEqual(CATALOG)
  year=await create('academic-years',{name:'2026-27',startsOn:'2026-04-01',endsOn:'2027-03-31',status:'Current'})
  expect((await req('POST','/suite/records/academic-years',{name:'Conflict',startsOn:'2026-04-01',endsOn:'2027-03-31',status:'Current'})).status()).toBe(409)
  teacher=(await good('POST','/teachers',{schoolId,employeeCode:'ST-1',firstName:'Maya',lastName:'Teacher',email:'maya'+schoolId+'@example.test',phoneNumber:'9000000002',department:'Science'},'Administrator',201)).id
  cl=await create('classes',{name:'Grade 6',section:'A',yearId:year,teacherId:teacher,capacity:30})
  subject=await create('subjects',{name:'Science',code:'SCI'})
  await create('teaching-assignments',{classId:cl,subjectId:subject,teacherId:teacher})
  admission=await create('admissions',{admissionNumber:'SA-001',firstName:'Aarav',lastName:'Learner',dateOfBirth:'2014-03-12',gender:'Male',email:'aarav'+schoolId+'@example.test',phoneNumber:'9000000003',guardianName:'Priya Guardian',guardianEmail:'priya'+schoolId+'@example.test',guardianPhone:'9'+Date.now().toString().slice(-9),address:'12 School Lane',classId:cl,status:'Submitted'})
  student=(await good('POST','/suite/admissions/'+admission+'/accept')).studentId
  expect((await req('POST','/suite/admissions/'+admission+'/accept')).status()).toBe(409)
  expect((await good('GET','/suite/allocations'))[0].studentId).toBe(student)
  await create('account-links',{userId:users.Teacher,teacherId:teacher})
  await create('account-links',{userId:users.Parent,studentId:student})
  await create('account-links',{userId:users.Student,studentId:student})
  for(const role of ['Teacher','Parent','Student'])await login(role)
  await create('school-config',{name:'Suite QA School',address:'12 School Lane',phone:'9000000000',currency:'INR',gradeA:90,gradeB:75,gradeC:60,gradeD:40,printFooter:'School office verification required.'})
 })
 test('enforces tenant and role boundaries on every module and linked profile',async()=>{
  expect((await req('GET','/suite/catalog?schoolId='+env.EDUOS_BOOTSTRAP_SCHOOL_ID)).status()).toBe(403)
  for(const role of ['Parent','Student','Teacher']){
   expect((await req('GET','/suite/records/admissions',undefined,role)).status()).toBe(403)
   expect((await req('POST','/suite/records/account-links',{userId:users[role],studentId:student},role)).status()).toBe(403)
   expect((await req('GET','/users',undefined,role)).status()).toBe(403)
  }
  expect((await good('GET','/suite/options',undefined,'Parent')).students.map((s:any)=>s.id)).toEqual([student])
  expect((await req('GET','/suite/report-cards/'+randomUUID(),undefined,'Parent')).status()).toBe(403)
  expect((await req('POST','/suite/records/subjects',{name:{nested:'bad'},code:'INVALID'})).status()).toBe(400)
  expect((await good('GET','/suite/catalog',undefined,'Principal')).map((m:any)=>m.kind)).toEqual(CATALOG)
 })
 test('checks assignments, timetable collisions, attendance, staff leave and notices',async()=>{
  const slot={classId:cl,subjectId:subject,teacherId:teacher,day:'Monday',startsAt:'09:00',endsAt:'09:45',room:'101'}
  await create('timetable',slot)
  expect((await req('POST','/suite/records/timetable',{...slot,startsAt:'09:30',endsAt:'10:00'})).status()).toBe(409)
  await good('POST','/suite/student-attendance',{day,entries:[{studentId:student,status:'Absent'}]},'Teacher')
  expect((await req('POST','/suite/student-attendance',{day,entries:[{studentId:student,status:'Present'},{studentId:randomUUID(),status:'Present'}]},'Teacher')).status()).toBe(403)
  expect((await good('GET','/suite/student-attendance?day='+day,undefined,'Teacher'))[0].status).toBe('Absent')
  expect((await good('POST','/suite/absence-notifications',{day})).sent).toBe(2)
  expect((await good('POST','/suite/absence-notifications',{day})).sent).toBe(0)
  expect((await list('messages','Parent')).length).toBe(1)
  await create('staff-attendance',{teacherId:teacher,day,status:'Present'})
  const leave=await create('leave-requests',{teacherId:teacher,fromDate:day,toDate:day,reason:'Appointment',status:'Pending'},'Teacher')
  const row=(await list('leave-requests','Teacher')).find((r:any)=>r.id===leave)
  expect((await req('PUT','/suite/records/leave-requests/'+leave,{...row,status:'Approved'},'Teacher')).status()).toBe(403)
  await good('PUT','/suite/records/leave-requests/'+leave,{...row,status:'Approved',approvalRemark:'Approved by principal'},'Principal')
  expect((await good('GET','/suite/reports/staff-attendance?month='+day.slice(0,7),undefined,'Teacher'))[0].present).toBe(1)
 })
 test('connects the timetable to leave: impact, approval, uncovered lessons, a safe substitute, and what each role sees',async()=>{
  // A school day next week, so the leave never collides with the one approved for today above.
  const monday=new Date();monday.setDate(monday.getDate()+((8-monday.getDay())%7||7));const date=monday.toISOString().slice(0,10)
  const slot1=await create('period-slots',{name:'Period 1',order:1,startsAt:'08:00',endsAt:'08:40',type:'Teaching'})
  await create('period-slots',{name:'Assembly',order:2,startsAt:'08:40',endsAt:'09:00',type:'Assembly'})
  expect((await req('POST','/suite/records/period-slots',{name:'Period 1b',order:3,startsAt:'08:20',endsAt:'08:50',type:'Teaching'})).status()).toBe(409)
  // A second teacher with an account: the substitute. A second class for the clash checks.
  const teacher2=(await good('POST','/teachers',{schoolId,employeeCode:'ST-2',firstName:'Nila',lastName:'Cover',email:'nila'+schoolId+'@example.test',phoneNumber:'9000000004',department:'Science'},'Administrator',201)).id
  const roles=await good('GET','/roles');users.Teacher2=(await good('POST','/users',{schoolId,roleId:roles.find((r:any)=>r.name==='Teacher').id,username:'suite.teacher2',email:'teacher2'+schoolId+'@example.test',firstName:'Nila',lastName:'QA',password},'Administrator',201)).id
  await create('account-links',{userId:users.Teacher2,teacherId:teacher2});await login('Teacher2')
  // A class of its own for this flow: the capacity test later creates Grade 7 - B, and a class is unique per name, section and year.
  const cl2=await create('classes',{name:'Grade 8',section:'A',yearId:year,teacherId:teacher2,capacity:30})
  await create('teaching-assignments',{classId:cl2,subjectId:subject,teacherId:teacher2});await create('teaching-assignments',{classId:cl2,subjectId:subject,teacherId:teacher})
  // Lessons placed by period: the first teacher takes Grade 6 in period 1 on that weekday, next to the 09:00 Monday lesson the
  // earlier test placed for the same class and teacher; a clash with the room is named.
  const weekday=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][monday.getDay()]
  const lesson=await create('timetable',{classId:cl,subjectId:subject,teacherId:teacher,day:weekday,slotId:slot1,room:'Lab 1'})
  expect((await req('POST','/suite/records/timetable',{classId:cl2,subjectId:subject,teacherId:teacher2,day:weekday,slotId:slot1,room:'lab 1'})).status()).toBe(409)
  expect((await req('POST','/suite/records/timetable',{classId:cl2,subjectId:subject,teacherId:teacher,day:weekday,startsAt:'08:10',endsAt:'08:30'})).status()).toBe(409)
  expect((await req('POST','/suite/records/timetable',{classId:cl2,subjectId:subject,teacherId:teacher2,day:weekday,startsAt:'10:00',endsAt:'09:00'})).status()).toBe(400)
  const week=await good('GET','/suite/timetable/week?classId='+cl+'&date='+date,undefined,'Student')
  expect(week.periods.map((p:any)=>[p.startsAt,p.subjectName,p.teacherName,p.substituted])).toEqual([['08:00','Science','Maya Teacher',false],['09:00','Science','Maya Teacher',false]]);expect(week.office).toBe(false);expect(week.slots.length).toBe(2)
  expect((await req('GET','/suite/timetable/week?teacherId='+teacher,undefined,'Student')).status()).toBe(403)
  expect((await req('GET','/suite/timetable/week?room=Lab 1',undefined,'Teacher')).status()).toBe(403)
  expect((await good('GET','/suite/timetable/week?room=Lab 1&date='+date)).periods.length).toBe(1)
  // Leave with a tracked balance: the request counts as pending, its impact names the lesson, and only leadership decides.
  const casual=await create('leave-types',{name:'Casual leave',code:'CL',paid:'Paid',yearlyAllowance:2,tracksBalance:'Yes',active:'Yes'})
  const leave=await create('leave-requests',{teacherId:teacher,typeId:casual,fromDate:date,toDate:date,reason:'Family function',status:'Pending'},'Teacher')
  const before=await good('GET','/suite/leave/balances',undefined,'Teacher');expect(before.balances.map((b:any)=>[b.code,b.allowance,b.pending,b.remaining])).toEqual([['CL',2,1,2]])
  expect((await req('POST','/suite/records/leave-requests',{teacherId:teacher,typeId:casual,fromDate:'2030-01-01',toDate:'2030-01-03',reason:'Too long',status:'Pending'},'Teacher')).status()).toBe(409)
  const impact=await good('GET','/suite/leave/'+leave+'/impact',undefined,'Teacher');expect(impact.summary).toEqual({affected:2,covered:0,uncovered:2});expect(impact.periods[0].className).toBe('Grade 6 - A')
  expect((await req('POST','/suite/leave/'+leave+'/decision',{decision:'Approved',remark:'ok'},'Teacher')).status()).toBe(403)
  for(const role of ['Student','Parent']){expect((await req('GET','/suite/leave/queue',undefined,role)).status()).toBe(403);expect((await req('GET','/suite/timetable/operations?date='+date,undefined,role)).status()).toBe(403);expect((await req('GET','/suite/leave/'+leave+'/impact',undefined,role)).status()).toBe(403)}
  expect((await req('GET','/suite/timetable/operations?date='+date,undefined,'Teacher')).status()).toBe(403)
  const queue=await good('GET','/suite/leave/queue',undefined,'Principal');const item=queue.items.find((i:any)=>i.id===leave);expect([item.typeName,item.days,item.remaining,item.impact.uncovered]).toEqual(['Casual leave',1,2,2])
  expect((await req('POST','/suite/leave/'+leave+'/decision',{decision:'Rejected',remark:''},'Principal')).status()).toBe(400)
  await good('POST','/suite/leave/'+leave+'/decision',{decision:'Approved',remark:'Enjoy'},'Principal')
  const after=await good('GET','/suite/leave/balances',undefined,'Teacher');expect(after.balances[0].used).toBe(1);expect(after.balances[0].remaining).toBe(1);expect(after.balances[0].pending).toBe(0)
  const approved=(await list('leave-requests','Teacher')).find((r:any)=>r.id===leave);expect(approved.status).toBe('Approved');expect(approved.decidedBy).toBeTruthy()
  // Approved leave is history: its dates cannot be edited, by the teacher or by leadership.
  expect((await req('PUT','/suite/records/leave-requests/'+leave,{...approved,reason:'Changed'},'Teacher')).status()).toBe(403)
  const refused=await req('PUT','/suite/records/leave-requests/'+leave,{...approved,toDate:'2030-01-01'},'Principal');expect(refused.status()).toBe(409);expect((await refused.json()).message).toBe('Decided leave cannot be edited. Cancel it and submit a new request.')
  const kept=(await list('leave-requests','Principal')).find((r:any)=>r.id===leave);expect([kept.status,kept.toDate,kept.version]).toEqual(['Approved',date,approved.version])
  // The day's operations show the uncovered lesson; the candidate list knows who is free; a busy substitute is refused.
  const ops=await good('GET','/suite/timetable/operations?date='+date,undefined,'Principal');expect(ops.summary).toEqual({away:1,affected:2,covered:0,uncovered:2});expect(ops.periods[0].status).toBe('uncovered')
  const candidates=await good('GET','/suite/timetable/candidates?timetableId='+lesson+'&date='+date,undefined,'Principal');expect(candidates.candidates.find((c:any)=>c.teacherId===teacher2).free).toBe(true)
  const busyLesson=await create('timetable',{classId:cl2,subjectId:subject,teacherId:teacher2,day:weekday,startsAt:'08:20',endsAt:'09:20'})
  expect((await req('POST','/suite/records/substitutions',{date,timetableId:lesson,teacherId:teacher2},'Principal')).status()).toBe(409)
  await good('DELETE','/suite/records/timetable/'+busyLesson)
  expect((await req('POST','/suite/records/substitutions',{date,timetableId:lesson,teacherId:teacher2},'Teacher')).status()).toBe(403)
  expect((await req('POST','/suite/records/substitutions',{date:'2030-01-01',timetableId:lesson,teacherId:teacher2},'Principal')).status()).toBe(400)
  const substitution=await create('substitutions',{date,timetableId:lesson,teacherId:teacher2,note:'Worksheet on the desk'},'Principal')
  expect((await req('POST','/suite/records/substitutions',{date,timetableId:lesson,teacherId:teacher2},'Principal')).status()).toBe(409)
  expect((await good('GET','/suite/timetable/operations?date='+date,undefined,'Principal')).summary).toEqual({away:1,affected:2,covered:1,uncovered:1})
  // The substitute sees the period they cover; the absent teacher sees it covered; the family sees the substitute and nothing about leave.
  const covering=await good('GET','/suite/timetable/today?date='+date,undefined,'Teacher2');expect(covering.periods.map((p:any)=>[p.covering,p.originalTeacherName,p.className])).toEqual([[true,'Maya Teacher','Grade 6 - A']])
  const own=await good('GET','/suite/timetable/today?date='+date,undefined,'Teacher');expect(own.away).toBe(true);expect(own.periods[0].status).toBe('covered');expect(own.periods[0].substitution.teacherName).toBe('Nila Cover')
  for(const role of ['Student','Parent']){const family=await good('GET','/suite/timetable/today?date='+date,undefined,role);const p=family.periods[0];expect([p.effectiveTeacherName,p.substituted,p.teacherName]).toEqual(['Nila Cover',true,'Maya Teacher']);expect(Object.keys(p)).not.toEqual(expect.arrayContaining(['status','away','substitution']));expect(JSON.stringify(family)).not.toContain('Family function')}
  expect((await good('GET','/suite/students/'+student+'/360',undefined,'Parent')).timetable.className).toBe('Grade 6 - A')
  expect((await req('GET','/suite/records/leave-requests',undefined,'Student')).status()).toBe(403);expect((await req('GET','/suite/records/substitutions',undefined,'Parent')).status()).toBe(403)
  expect((await list('substitutions','Teacher2')).map((r:any)=>r.id)).toEqual([substitution])
  // A pending request can be withdrawn by its owner; leadership's balance adjustments are permanent history.
  const later=await create('leave-requests',{teacherId:teacher,typeId:casual,fromDate:'2030-02-01',toDate:'2030-02-01',reason:'Later',status:'Pending'},'Teacher')
  await good('POST','/suite/leave/'+later+'/cancel',{},'Teacher');expect((await list('leave-requests','Teacher')).find((r:any)=>r.id===later).status).toBe('Cancelled')
  const adjustment=await create('leave-adjustments',{teacherId:teacher,typeId:casual,direction:'Add',days:1,effectiveOn:date,reason:'Carried over'},'Principal')
  expect((await req('DELETE','/suite/records/leave-adjustments/'+adjustment)).status()).toBe(403)
  expect((await good('GET','/suite/leave/balances?teacherId='+teacher,undefined,'Principal')).balances[0].remaining).toBe(2)
 })
 test('keeps fees exact, payments idempotent, receipts private and balances non-negative',async()=>{
  const structure=await create('fee-structures',{name:'Tuition',classId:cl,amount:1000.10,installment:'Term 1',dueDate:day})
  charge=(await good('POST','/suite/fees/charges',{studentId:student,structureId:structure,concession:100.05},'Administrator',201)).id
  expect((await req('POST','/suite/fees/charges',{studentId:student,structureId:structure,concession:100.05})).status()).toBe(409)
  const payment={chargeId:charge,amount:900.05,method:'UPI',reference:'QA-REFERENCE',paidOn:day,idempotencyKey:randomUUID()}
  const responses=await Promise.all([req('POST','/suite/fees/payments',payment),req('POST','/suite/fees/payments',payment)])
  expect(responses.map(r=>r.status()).sort()).toEqual([200,201])
  const ids=await Promise.all(responses.map(async r=>(await r.json()).data.id));expect(ids[0]).toBe(ids[1])
  expect((await req('POST','/suite/fees/payments',{...payment,amount:0.01,idempotencyKey:randomUUID()})).status()).toBe(409)
  expect((await good('GET','/suite/fees',undefined,'Parent'))[0].balance).toBe(0)
  expect((await good('GET','/suite/fees/receipts/'+ids[0],undefined,'Parent')).receipt.amount).toBe(900.05)
  expect((await req('GET','/suite/fees',undefined,'Teacher')).status()).toBe(403)
  expect((await req('POST','/suite/fees/payments',payment,'Parent')).status()).toBe(403)
 })
 test('publishes bounded marks and protects stale updates and report cards',async()=>{
  exam=await create('exams',{name:'Term 1',classId:cl,subjectId:subject,date:day,maxMarks:100,passMarks:40,status:'Draft'})
  expect((await req('POST','/suite/records/marks',{examId:exam,studentId:student,score:101},'Teacher')).status()).toBe(400)
  await create('marks',{examId:exam,studentId:student,score:92,remarks:'Excellent progress'},'Teacher')
  expect((await list('marks','Parent')).length).toBe(0)
  const row=(await list('exams')).find((r:any)=>r.id===exam)
  await good('PUT','/suite/records/exams/'+exam,{...row,status:'Published'})
  expect((await req('PUT','/suite/records/exams/'+exam,{...row,status:'Published'})).status()).toBe(409)
  const report=await good('GET','/suite/report-cards/'+student,undefined,'Parent')
  expect(report.grade).toBe('A');expect(report.percent).toBe(92);expect(report.results).toHaveLength(1)
  expect((await list('marks','Student')).length).toBe(1)
 })
 test('supports homework, protected documents, student submissions and teacher feedback',async()=>{
  homework=await create('homework',{title:'Explore plants',classId:cl,subjectId:subject,dueDate:day,instructions:'Describe how plants grow.'},'Teacher')
  submission=await create('submissions',{homeworkId:homework,studentId:student,response:'Plants need sunlight and water.'},'Student')
  let row=(await list('submissions','Student'))[0]
  expect((await req('PUT','/suite/records/submissions/'+submission,{...row,grade:'A'},'Student')).status()).toBe(403)
  await good('PUT','/suite/records/submissions/'+submission,{...row,feedback:'Well explained',grade:'A'},'Teacher')
  row=(await list('submissions','Parent'))[0];expect(row.feedback).toBe('Well explained')
  const upload=await api.post('/api/v1/suite/documents?recordId='+submission,{headers:headers('Student'),multipart:{file:{name:'answer.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nQA document\n%%EOF')}}})
  expect(upload.status(),await upload.text()).toBe(201);const id=(await upload.json()).data.id;docs.push(id)
  expect((await req('GET','/suite/documents/'+id,undefined,'Parent')).status()).toBe(200)
  const wrong=await api.post('/api/v1/suite/documents?recordId='+submission,{headers:headers('Student'),multipart:{file:{name:'answer.exe',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nbad extension')}}})
  expect(wrong.status()).toBe(400)
  const noAccess=await api.post('/api/v1/suite/documents?recordId='+admission,{headers:headers('Parent'),multipart:{file:{name:'answer.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4')}}})
  expect(noAccess.status()).toBe(403)
 })
 test('tracks acknowledgements, certificates, exports and atomic imports',async()=>{
  circular=await create('circulars',{title:'Family meeting',message:'Meet your class teacher this Friday.',audience:'Parent',classId:cl,dueDate:day})
  await good('POST','/suite/circulars/'+circular+'/acknowledge',undefined,'Parent')
  await good('POST','/suite/circulars/'+circular+'/acknowledge',undefined,'Parent')
  expect((await good('GET','/suite/circulars/'+circular+'/acknowledgements')).length).toBe(1)
  expect((await req('POST','/suite/circulars/'+circular+'/acknowledge',undefined,'Student')).status()).toBe(403)
  await create('calendar',{title:'School assembly',startsOn:day,endsOn:day,description:'Whole school assembly.'})
  certificate=await create('certificates',{studentId:student,type:'Bonafide certificate',issuedOn:day,remarks:'For school record verification.'})
  expect((await good('GET','/suite/certificates/'+certificate+'/print',undefined,'Parent')).certificate.certificateNumber).toMatch(/^DOC-/)
  const row={rollNumber:'IM-1',firstName:'Imported',lastName:'Student',email:'import'+schoolId+'@example.test',phoneNumber:'9000000008',dateOfBirth:'2014-01-01',currentClass:'Grade 6 - A'}
  expect((await good('POST','/suite/imports/students',{rows:[row],commit:false})).valid).toBe(true)
  expect((await good('POST','/suite/imports/students',{rows:[row],commit:true})).committed).toBe(true)
  expect((await req('POST','/suite/imports/students',{rows:[{...row,rollNumber:'IM-2',email:'im2'+schoolId+'@example.test'},row],commit:true})).status()).toBe(409)
  const directory=await good('GET','/operations/directory/students?search=Imported');expect(directory.totalCount).toBe(1)
  expect((await good('GET','/suite/reports/audit')).some((r:any)=>r.actor==='suite.teacher')).toBe(true)
 })

 test('preserves issued certificates and keeps class allocation consistent under capacity failures',async()=>{
  const all=await good('GET','/operations/directory/students')
  const pupil=all.data.find((r:any)=>r.id===student),imported=all.data.find((r:any)=>r.rollNumber==='IM-1')
  expect((await req('PUT','/students/'+student,{...pupil,schoolId,currentClass:'Unallocated fake class'})).status()).toBe(409)
  const destination=await create('classes',{name:'Grade 7',section:'B',yearId:year,teacherId:teacher,capacity:1})
  expect((await req('POST','/suite/allocate',{studentIds:[student,imported.id],classId:destination})).status()).toBe(409)
  expect((await good('GET','/suite/allocations')).find((r:any)=>r.studentId===student).classId).toBe(cl)
  await good('POST','/suite/allocate',{studentIds:[imported.id],classId:destination})
  const classRow=(await list('classes')).find((r:any)=>r.id===cl)
  await good('PUT','/suite/records/classes/'+cl,{...classRow,name:'Grade 6 Updated'})
  const updated=(await good('GET','/operations/directory/students')).data.find((r:any)=>r.id===student)
  expect(updated.currentClass).toBe('Grade 6 Updated - A')
  expect((await good('GET','/suite/certificates/'+certificate+'/print')).student.class).toBe('Grade 6 - A')
 })

 test('browser renders modules, creates records, exports Excel and prints without accessibility errors',async({page})=>{
  await browserSession(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await page.setViewportSize({width:1440,height:1000});await page.goto('/suite')
  await expect(page.getByRole('heading',{name:'Your school, connected.'})).toBeVisible()
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();expect(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([])
  for(const route of ['academic-years','classes','admissions','timetable','marks','homework','fees','reports','account-links']){
   await page.goto('/suite/'+route);await expect(page.locator('h1')).toBeVisible();await expect(page.locator('[role="alert"]')).toHaveCount(0)
  }
  await page.goto('/suite/subjects');await page.getByRole('button',{name:'Add record'}).click()
  await page.getByLabel('Subject',{exact:true}).fill('Mathematics');await page.getByLabel('Subject code',{exact:true}).fill('MATH')
  await page.getByRole('button',{name:'Save record'}).click();await expect(page.getByText('Mathematics',{exact:true})).toBeVisible()
  await page.goto('/suite/reports');const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download Excel',exact:true}).click()
  const file=await download;expect(file.suggestedFilename()).toMatch(/\.xlsx$/);expect(await file.failure()).toBeNull()

  const {default:writeExcelFile}=await import('write-excel-file/universal')
  const book=await writeExcelFile([['rollNumber','firstName','lastName','email','phoneNumber','dateOfBirth','currentClass'],['XL-1','Workbook','Student','workbook'+schoolId+'@example.test','9000000007','2014-01-01','Grade 6 - A']].map(row=>row.map(value=>({value,type:String})))).toBlob()
  await page.locator('input[type="file"]').setInputFiles({name:'students.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await book.arrayBuffer())})
  await expect(page.getByText(/1 rows passed field validation/)).toBeVisible()
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Confirm import of 1 records'}).click()
  await expect(page.getByText('1 records imported.')).toBeVisible()

  await page.getByRole('combobox',{name:/^Student/}).selectOption(student)
  const popup=page.waitForEvent('popup');await page.getByRole('button',{name:'Open report card'}).click();const printed=await popup;await expect(printed.getByRole('heading',{name:'Student report card'})).toBeVisible();await expect(printed.getByText('Excellent progress')).toBeVisible();await printed.close()
  mkdirSync(path.join(root,'.local/screenshots'),{recursive:true});await page.goto('/suite');await page.screenshot({path:path.join(root,'.local/screenshots/suite-desktop.png'),fullPage:true})
  await page.setViewportSize({width:390,height:844});await expect(page.locator('h1')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:path.join(root,'.local/screenshots/suite-mobile.png'),fullPage:true});expect(errors).toEqual([])
 })
 test('parent portal exposes only family modules and records',async({page})=>{
  await browserSession(page,'Parent');await page.goto('/suite');await expect(page.getByRole('heading',{name:/Your family/})).toBeVisible()
  await page.goto('/suite/fees');await expect(page.getByText('Aarav Learner',{exact:true}).first()).toBeVisible();await expect(page.getByRole('button',{name:'Issue charge'})).toHaveCount(0)
  await page.goto('/students');await expect(page.getByRole('heading',{name:'This area isn’t available for your role'})).toBeVisible()
 })

 test('rehearses a paired database and document restore without replacing live data',async()=>{
  test.setTimeout(180000)
  const output=execFileSync(process.execPath,[path.join(root,'scripts/backup.mjs')],{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:120000})
  const folder=output.split(/\r?\n/).find(line=>line.startsWith('Database and documents backup saved: '))?.replace('Database and documents backup saved: ','').trim()
  expect(folder).toBeTruthy()
  const restored=execFileSync(process.execPath,[path.join(root,'scripts/restore.mjs'),folder!],{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:120000})
  expect(restored).toContain('Restore rehearsal passed:')
  expect(restored).not.toContain('0 registered document')
  expect((await list('submissions','Parent'))[0].feedback).toBe('Well explained')
 })

 test('recovery codes expire after one use and revoke previous sessions',async()=>{
  const code=(await good('POST','/users/'+users.Parent+'/recovery-code')).code
  const newPassword='QA-Recovered-'+randomUUID()
  const response=await throttled(()=>api.post('/api/v1/auth/reset-password',{data:{code,password:newPassword}}))
  expect(response.status(),await response.text()).toBe(200)
  expect((await req('GET','/suite/catalog',undefined,'Parent')).status()).toBe(401)
  expect((await api.post('/api/v1/auth/refresh',{data:{refreshToken:sessions.Parent.refreshToken}})).status()).toBe(401)
  expect((await throttled(()=>api.post('/api/v1/auth/reset-password',{data:{code,password:newPassword}}))).status()).toBe(400)
  await login('Parent',newPassword);expect((await req('GET','/suite/catalog',undefined,'Parent')).status()).toBe(200)
 })
 test('prevents concurrent requests from disabling the last two administrators',async()=>{
  // Only an Administrator may manage accounts, so the acting administrator disables itself and the only other
  // administrator at once. Exactly one request may win; the loser is refused (409) or, if it arrives after its
  // own account was disabled, signed out (401). Either way the school keeps one active administrator.
  // Administrators are provisioned by the platform, never by a school administrator, so the second one is seeded directly.
  const second=randomUUID()
  sql("INSERT INTO auth_db.users(id,school_id,username,email,password_hash,first_name,last_name,role_id) SELECT '"+second+"','"+schoolId+"','suite.secondadmin','second"+schoolId+"@example.test',password_hash,'Second','Admin',role_id FROM auth_db.users WHERE id='"+adminId+"'")
  expect((await req('POST','/users',{schoolId,roleId:(await good('GET','/roles')).find((r:any)=>r.name==='Administrator').id,username:'suite.thirdadmin',email:'third'+schoolId+'@example.test',firstName:'Third',lastName:'Admin',password})).status(),'school administrators cannot provision administrators').toBe(403)
  // Administrator accounts are platform-controlled: a school administrator can disable neither itself nor a peer, so
  // concurrent attempts both fail and the school keeps every active administrator.
  const statuses=(await Promise.all([adminId,second].map(id=>req('PUT','/users/'+id,{isActive:false})))).map(r=>r.status())
  expect(statuses,'administrators are managed by the platform, not by each other').toEqual([403,403])
  expect(sql("SELECT 'active='||count(*) FROM auth_db.users u JOIN auth_db.roles r ON r.id=u.role_id WHERE u.school_id='"+schoolId+"' AND u.is_active AND u.deleted_at IS NULL AND r.name='Administrator'")).toContain('active=2')
 })

 test('publishes an urgent communication to the parents of one class, exactly once, and tracks who read and acknowledged it',async()=>{
  const tag=schoolId.slice(0,8),key=(id:string)=>"'circular.published:"+id+"'"
  const count=(where:string)=>Number(/n=(\d+)/.exec(sql("SELECT 'n='||count(*) FROM "+where))![1])
  const notified=(id:string)=>count("notify.recipients r JOIN notify.notifications n ON n.id=r.notification_id WHERE n.school_id='"+schoolId+"' AND n.event_key="+key(id))
  // A second class with its own teacher and no families: it must receive nothing.
  const other=(await good('POST','/teachers',{schoolId,employeeCode:'ST-9'+tag,firstName:'Other',lastName:'Teacher',email:'other'+schoolId+'@example.test',phoneNumber:'9000000012',department:'Arts'},'Administrator',201)).id
  const otherClass=await create('classes',{name:'Grade 9',section:'C',yearId:year,teacherId:other,capacity:30})
  // The principal drafts it: nobody but leadership sees a draft, and the audience is counted on the server.
  const body={title:'Severe weather: school closed '+tag,message:'The school stays closed tomorrow.',audience:'Parent',classId:cl,type:'Alert',priority:'Urgent',requiresAcknowledgement:'Yes'}
  // The audience is named after the class as it is now (renamed earlier in this lifecycle); the snapshot keeps that name from publication on.
  const classRow=(await list('classes')).find((r:any)=>r.id===cl),audienceLabel='Parents of '+classRow.name+' - '+classRow.section
  const draft=await create('circulars',{...body,status:'Draft'},'Principal')
  expect((await good('GET','/suite/communications/'+draft,undefined,'Principal')).status).toBe('Draft')
  expect((await good('GET','/suite/communications/feed',undefined,'Parent')).items.map((i:any)=>i.id)).not.toContain(draft)
  expect((await list('circulars','Parent')).map((r:any)=>r.id)).not.toContain(draft)
  expect(await good('POST','/suite/communications/audience',{audience:'Parent',classId:cl},'Principal')).toEqual({count:1,label:audienceLabel})
  expect((await good('POST','/suite/communications/audience',{audience:'Parent',classId:otherClass},'Principal')).count).toBe(0)
  expect((await req('POST','/suite/records/circulars',{...body,status:'Scheduled',publishAt:'2020-01-01T09:00:00Z'},'Principal')).status()).toBe(400)
  // Families and teachers never reach the administrative calls; a student cannot see the draft by id.
  for(const role of ['Teacher','Parent','Student']){for(const url of ['/suite/communications','/suite/communications/attention','/suite/communications/'+draft,'/suite/communications/'+draft+'/acknowledgements'])expect((await req('GET',url,undefined,role)).status(),role+' '+url).toBe(403)
   expect((await req('POST','/suite/communications/'+draft+'/publish',{version:1},role)).status()).toBe(403);expect((await req('POST','/suite/communications/audience',{audience:'All'},role)).status()).toBe(403)}
  expect((await req('POST','/suite/communications/'+draft+'/read',undefined,'Parent')).status()).toBe(404)
  // A double click publishes once: both requests succeed, one notification exists, one person was told.
  const clicks=await Promise.all([req('POST','/suite/communications/'+draft+'/publish',{version:1},'Principal'),req('POST','/suite/communications/'+draft+'/publish',{version:1},'Principal')])
  expect(clicks.map(r=>r.status())).toEqual([200,200])
  const published=await good('GET','/suite/communications/'+draft,undefined,'Principal')
  expect([published.status,published.snapshot.count,published.snapshot.audience,published.counts.intended,published.counts.notified,published.counts.read,published.counts.outstanding]).toEqual(['Published',1,audienceLabel,1,1,0,1])
  expect(count("notify.notifications WHERE school_id='"+schoolId+"' AND event_key="+key(draft))).toBe(1);expect(notified(draft)).toBe(1)
  // Only the parent of that class was told, with the urgency in the title; the student, the teacher and the other class heard nothing.
  const inbox=await good('GET','/notifications',undefined,'Parent'),note=inbox.items.find((i:any)=>i.destination?.entityId===draft)
  expect([note.type,note.title,note.readAt,note.destination.route]).toEqual(['circular.published','Urgent: Severe weather: school closed '+tag,null,'notices'])
  expect((await good('GET','/notifications/unread-count',undefined,'Parent')).unread).toBe(inbox.unread);expect(inbox.unread).toBeGreaterThanOrEqual(1)
  for(const role of ['Student','Teacher','Principal'])expect((await good('GET','/notifications',undefined,role)).items.some((i:any)=>i.destination?.entityId===draft),role).toBe(false)
  // The parent opens it (read recorded once) and acknowledges twice (recorded once); leadership sees the figures and the names, never contact details.
  const feed=await good('GET','/suite/communications/feed',undefined,'Parent'),mine=feed.items.find((i:any)=>i.id===draft)
  expect([mine.priority,mine.requiresAcknowledgement,mine.readAt,mine.acknowledgedAt,mine.canAcknowledge]).toEqual(['Urgent',true,null,null,true]);expect(feed.acknowledgementsDue).toBeGreaterThanOrEqual(1)
  expect((await good('POST','/suite/communications/'+draft+'/read',undefined,'Parent')).readAt).toBeTruthy()
  await good('POST','/suite/circulars/'+draft+'/acknowledge',undefined,'Parent');await good('POST','/suite/circulars/'+draft+'/acknowledge',undefined,'Parent')
  expect((await req('POST','/suite/circulars/'+draft+'/acknowledge',undefined,'Student')).status()).toBe(403)
  const tracked=await good('GET','/suite/communications/'+draft,undefined,'Principal');expect([tracked.counts.read,tracked.counts.acknowledged,tracked.counts.outstanding]).toEqual([1,1,0])
  const who=await good('GET','/suite/communications/'+draft+'/acknowledgements',undefined,'Principal');expect([who.intended,who.acknowledged.length,who.outstanding]).toEqual([1,1,[]]);expect(JSON.stringify(who)).not.toContain('@')
  expect((await good('GET','/notifications',undefined,'Parent')).items.find((i:any)=>i.destination?.entityId===draft).readAt).toBeTruthy()
  expect(count("suite.acknowledgements WHERE school_id='"+schoolId+"' AND record_id='"+draft+"'")).toBe(1)
  expect(count("suite.audit WHERE school_id='"+schoolId+"' AND entity_id='"+draft+"' AND action='communication.published'")).toBe(1)
  // After publication the audience is frozen; the wording may change (audited) and that never notifies again.
  expect((await req('PUT','/suite/records/circulars/'+draft,{...body,audience:'All',classId:'',status:'Published',version:tracked.version},'Principal')).status()).toBe(409)
  await good('PUT','/suite/records/circulars/'+draft,{...body,message:'The school stays closed tomorrow. Buses do not run.',status:'Published',version:tracked.version},'Principal')
  expect(count("suite.audit WHERE school_id='"+schoolId+"' AND entity_id='"+draft+"' AND action='communication.edited'")).toBe(1);expect(notified(draft)).toBe(1)
  // Teachers hold no circulars.manage under the fixed role templates (a template's maximum caps what a school may grant), so every
  // compose and status call is refused at the gateway; the teacher class rules behind it are covered by CommunicationRulesTests.
  expect((await req('POST','/suite/records/circulars',{title:'Homework diary '+tag,message:'Please sign the diary.',audience:'Parent',classId:cl,status:'Published'},'Teacher')).status()).toBe(403)
  expect((await req('POST','/suite/communications/'+draft+'/archive',{version:tracked.version+1},'Teacher')).status()).toBe(403)
  // Scheduling is durable state: a scheduled communication tells nobody, needs a reason to cancel, and a cancelled one never goes out.
  // A week ahead in UTC: always in the future and well inside the one-year scheduling window, whenever this runs.
  const nextWeek=new Date(Date.now()+7*24*60*60*1000).toISOString()
  const scheduled=await create('circulars',{title:'Sports day '+tag,message:'Volunteers needed.',audience:'All',status:'Scheduled',publishAt:nextWeek},'Principal')
  expect((await good('GET','/suite/communications/feed',undefined,'Parent')).items.map((i:any)=>i.id)).not.toContain(scheduled);expect(notified(scheduled)).toBe(0)
  expect((await req('POST','/suite/communications/'+scheduled+'/cancel',{version:1},'Principal')).status()).toBe(400)
  await good('POST','/suite/communications/'+scheduled+'/cancel',{version:1,reason:'Postponed'},'Principal')
  expect((await good('GET','/suite/communications/'+scheduled,undefined,'Principal')).status).toBe('Cancelled');expect(notified(scheduled)).toBe(0)
  expect((await req('POST','/suite/communications/'+scheduled+'/publish',{version:2},'Principal')).status()).toBe(409)
  const attention=await good('GET','/suite/communications/attention',undefined,'Principal');expect(attention.urgent.some((i:any)=>i.id===draft)).toBe(true);expect(attention.deliveries.channels).toEqual(['in-app'])
  // One existing business event, end to end: the published exam reached the family's inbox with a destination the family may open.
  const result=(await good('GET','/notifications',undefined,'Parent')).items.find((i:any)=>i.type==='result.published')
  expect([result.destination.route,result.destination.entityId]).toEqual(['results',exam]);expect(result.title).toContain('Term 1')
  expect((await good('GET','/notifications',undefined,'Student')).items.some((i:any)=>i.type==='result.published')).toBe(true)
  expect((await good('GET','/notifications',undefined,'Teacher')).items.some((i:any)=>i.type==='result.published')).toBe(false)
  expect(count("notify.notifications WHERE school_id='"+schoolId+"' AND event_key='result.published:"+exam+"'")).toBe(1)
  expect((await list('marks','Parent')).map((m:any)=>m.examId)).toContain(exam)
  // Archiving keeps the history and takes it out of the feed.
  await good('POST','/suite/communications/'+draft+'/archive',{version:tracked.version+1},'Principal')
  expect((await good('GET','/suite/communications/'+draft,undefined,'Principal')).history.map((h:any)=>h.to)).toEqual(['Draft','Published','Archived'])
  expect((await good('GET','/suite/communications/feed',undefined,'Parent')).items.map((i:any)=>i.id)).not.toContain(draft)
 })

 test('takes one child from application to active student: decisions, duplicates, onboarding, activation and what each role then sees',async()=>{
  const tag=schoolId.slice(0,8),guardianEmail='omar'+schoolId+'@example.test',childEmail='zara'+schoolId+'@example.test'
  const application={firstName:'Zara',lastName:'Newton',dateOfBirth:'2015-06-09',gender:'Female',email:childEmail,guardianName:'Omar Newton',guardianEmail,guardianPhone:'8'+Date.now().toString().slice(-9),address:'4 Admission Road',classId:cl,reviewNotes:'Strong interview '+tag}
  const app=await create('admissions',{...application,status:'Draft'})
  const draft=(await good('GET','/suite/admissions/'+app));expect(draft.applicationNumber).toMatch(/^APP-\d{4}-\d{6}$/);expect(draft.status).toBe('Draft');expect(draft.application.reviewNotes).toContain('Strong interview')
  // Families, teachers and students never reach the admissions office.
  for(const role of ['Teacher','Parent','Student']){expect((await req('GET','/suite/admissions/pipeline',undefined,role)).status()).toBe(403);expect((await req('POST','/suite/admissions/'+app+'/transition',{to:'Submitted'},role)).status()).toBe(403);expect((await req('POST','/suite/admissions/'+app+'/activate',undefined,role)).status()).toBe(403)}
  // Status moves only through decisions, and a generic edit cannot jump the lifecycle.
  expect((await req('PUT','/suite/records/admissions/'+app,{...application,status:'Approved',version:draft.version})).status()).toBe(409)
  await good('POST','/suite/admissions/'+app+'/transition',{to:'Submitted'})
  await good('POST','/suite/admissions/'+app+'/transition',{to:'Under Review'},'Principal')
  // A second application for the same child is flagged, never merged; approval needs the duplicate acknowledged.
  const twin=await create('admissions',{...application,email:'twin'+schoolId+'@example.test',status:'Submitted'})
  const reviewing=await good('GET','/suite/admissions/'+app);expect(reviewing.duplicates.map((d:any)=>[d.id,d.reasons[0]])).toEqual([[twin,'Same name and date of birth']])
  expect((await req('POST','/suite/admissions/'+app+'/transition',{to:'Approved'},'Principal')).status()).toBe(409)
  expect((await req('POST','/suite/admissions/'+twin+'/transition',{to:'Withdrawn'})).status()).toBe(400)
  await good('POST','/suite/admissions/'+twin+'/transition',{to:'Withdrawn',reason:'Entered twice'})
  expect((await req('POST','/suite/admissions/'+app+'/transition',{to:'Approved'},'Teacher')).status()).toBe(403)
  await good('POST','/suite/admissions/'+app+'/transition',{to:'Approved',reason:'Meets criteria'},'Principal')
  expect((await req('POST','/suite/admissions/'+app+'/transition',{to:'Approved'},'Principal')).status()).toBe(200)
  // Approval creates nothing; onboarding is the office's, and starting it twice at once is one start.
  expect((await req('POST','/suite/admissions/'+app+'/onboarding/start',undefined,'Principal')).status()).toBe(403)
  const starts=await Promise.all([req('POST','/suite/admissions/'+app+'/onboarding/start'),req('POST','/suite/admissions/'+app+'/onboarding/start')])
  expect(starts.map(r=>r.status())).toEqual([200,200]);expect((await Promise.all(starts.map(async r=>(await r.json()).data.started))).filter(Boolean)).toHaveLength(1)
  expect(sql("SELECT 'n='||count(*) FROM student_db.students WHERE school_id='"+schoolId+"' AND email='"+childEmail+"'")).toContain('n=0')
  expect((await req('POST','/suite/admissions/'+app+'/activate')).status()).toBe(409)
  const put=(body:any)=>req('PUT','/suite/admissions/'+app+'/onboarding',body)
  await good('PUT','/suite/admissions/'+app+'/onboarding',{section:'details',confirmed:true,admissionNumber:'ADM-QA-'+tag})
  // Another family's guardian cannot be linked: only one whose email or phone is on the application.
  const otherParent=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(sql("SELECT id FROM parent_db.parents WHERE school_id='"+schoolId+"' AND email='priya"+schoolId+"@example.test'"))![0]
  const refused=await put({section:'guardian',mode:'existing',parentId:otherParent,relationship:'Father',confirmed:true});expect(refused.status()).toBe(400);expect((await refused.json()).message).toBe('Only a guardian whose email or phone matches the application can be linked.')
  await good('PUT','/suite/admissions/'+app+'/onboarding',{section:'guardian',mode:'new',relationship:'Father',confirmed:true})
  expect((await put({section:'documents',key:'birth-certificate',status:'Verified'})).status()).toBe(400)
  const upload=await api.post('/api/v1/suite/documents?recordId='+app,{headers:headers(),multipart:{file:{name:'birth.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nbirth certificate\n%%EOF')}}});expect(upload.status()).toBe(201);docs.push((await upload.json()).data.id)
  for(const key of ['birth-certificate','address-proof'])await good('PUT','/suite/admissions/'+app+'/onboarding',{section:'documents',key,status:'Verified'})
  expect((await put({section:'academics',classId:randomUUID()})).status()).toBe(404)
  await good('PUT','/suite/admissions/'+app+'/onboarding',{section:'academics',classId:cl})
  const structure=await create('fee-structures',{name:'Admission fee '+tag,classId:cl,amount:2500.50,installment:'One time',dueDate:day})
  await good('PUT','/suite/admissions/'+app+'/onboarding',{section:'fees',mode:'assign',structureIds:[structure]})
  // The family's account comes from the existing account system and is linked only when its email matches.
  const roles=await good('GET','/roles'),parentPassword='QA-Parent-'+randomUUID()
  const parentUser=(await good('POST','/users',{schoolId,roleId:roles.find((r:any)=>r.name==='Parent').id,username:'suite.omar.'+tag,email:guardianEmail,firstName:'Omar',lastName:'Newton',password:parentPassword},'Administrator',201)).id
  expect((await put({section:'accounts',parentUserId:users.Parent})).status()).toBe(400)
  const ready=await good('PUT','/suite/admissions/'+app+'/onboarding',{section:'accounts',parentUserId:parentUser});expect(ready.status).toBe('Ready');expect(ready.onboarding.blockers).toEqual([])
  // Activation commits everything at once; repeating it, or accepting it again, creates nothing more.
  const activated=await good('POST','/suite/admissions/'+app+'/activate');expect(activated.activated).toBe(true)
  const again=await good('POST','/suite/admissions/'+app+'/activate');expect([again.activated,again.studentId]).toEqual([false,activated.studentId])
  expect((await req('POST','/suite/admissions/'+app+'/accept')).status()).toBe(409)
  const child=activated.studentId
  for(const [table,where] of [['student_db.students',"email='"+childEmail+"'"],['parent_db.parents',"email='"+guardianEmail+"'"],['suite.charges',"student_id='"+child+"'"],['suite.student_classes',"student_id='"+child+"'"],['suite.records',"kind='account-links' AND data->>'userId'='"+parentUser+"'"]] as const)
   expect(sql("SELECT 'n='||count(*) FROM "+table+" WHERE school_id='"+schoolId+"' AND "+where),table).toContain('n=1')
  expect((await good('GET','/suite/allocations')).find((r:any)=>r.studentId===child).classId).toBe(cl)
  const ledger=await good('GET','/suite/fees/ledger/'+child);expect([ledger.totals.net,ledger.charges.length]).toEqual([2500.5,1])
  // The teacher of the class can mark the student; the office's history explains every step.
  expect((await good('GET','/suite/student-attendance?day='+day,undefined,'Teacher')).some((s:any)=>s.id===child)).toBe(true)
  expect(Number(/\d+/.exec(sql("SELECT count(*) FROM suite.audit WHERE school_id='"+schoolId+"' AND entity_id='"+app+"'"))![0])).toBeGreaterThanOrEqual(8)
  expect((await good('GET','/suite/admissions/'+app)).history.map((h:any)=>h.to)).toEqual(['Draft','Submitted','Under Review','Approved','Onboarding','Ready','Active'])
  // The new family sees its own child only, with the admission number and nothing from the review.
  const signIn=await throttled(()=>api.post('/api/v1/auth/login',{data:{schoolId,username:'suite.omar.'+tag,password:parentPassword}}));expect(signIn.status(),await signIn.text()).toBe(200);sessions.NewParent=(await signIn.json()).data
  const view=await good('GET','/suite/students/'+child+'/360',undefined,'NewParent');expect(view.admission.admissionNumber).toBe('ADM-QA-'+tag)
  const text=JSON.stringify(view);expect(text).not.toContain('Strong interview');expect(text).not.toContain('Meets criteria');expect(text).not.toContain('Entered twice')
  expect((await req('GET','/suite/students/'+student+'/360',undefined,'NewParent')).status()).toBe(403)
  expect((await req('GET','/suite/students/'+child+'/360',undefined,'Parent')).status()).toBe(403)
  const teacherView=await good('GET','/suite/students/'+child+'/360',undefined,'Teacher');expect(Object.keys(teacherView.admission).sort()).toEqual(['admissionNumber','admittedOn','available'])
  expect((await req('PUT','/suite/records/admissions/'+app,{...application,status:'Active',version:99})).status()).toBe(409)
 })
})
