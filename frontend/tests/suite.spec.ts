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
const headers=(role='SuperAdmin')=>({Authorization:'Bearer '+sessions[role].accessToken})
const req=async(method:string,url:string,body?:any,role='SuperAdmin')=>api.fetch('/api/v1'+url,{method,headers:headers(role),...(body===undefined?{}:{data:body})})
async function good(method:string,url:string,body?:any,role='SuperAdmin',status=200){const r=await req(method,url,body,role);expect(r.status(),await r.text()).toBe(status);return(await r.json()).data}
const create=async(kind:string,body:any,role='SuperAdmin')=>(await good('POST','/suite/records/'+kind,body,role,201)).id
const list=async(kind:string,role='SuperAdmin')=>(await good('GET','/suite/records/'+kind,undefined,role)).data
// nginx limits login and reset-password to 10/min per client (burst 10); wait out a 429 when earlier specs used the budget.
async function throttled(send:()=>Promise<APIResponse>){for(let i=0;;i++){const r=await send();if(r.status()!==429||i>=15)return r;await new Promise(f=>setTimeout(f,6500))}}
async function login(role:string,pw=password){const r=await throttled(()=>api.post('/api/v1/auth/login',{data:{schoolId,username:'suite.'+role.toLowerCase(),password:pw}}));expect(r.status(),await r.text()).toBe(200);sessions[role]=(await r.json()).data}
async function browserSession(page:Page,role='SuperAdmin'){await page.addInitScript(s=>{localStorage.setItem('accessToken',s.accessToken);localStorage.setItem('refreshToken',s.refreshToken);localStorage.setItem('user',JSON.stringify(s.user))},sessions[role])}
test.describe.serial('Complete school suite',()=>{
 test.beforeAll(async({playwright})=>{
  test.setTimeout(180000)
  const role=randomUUID()
  sql("BEGIN; INSERT INTO school_db.schools(id,name) VALUES('"+schoolId+"','Suite QA School'); INSERT INTO auth_db.roles(id,school_id,name) VALUES('"+role+"','"+schoolId+"','SuperAdmin'); INSERT INTO auth_db.users(id,school_id,username,email,password_hash,first_name,last_name,role_id) SELECT '"+adminId+"','"+schoolId+"','suite.superadmin','suite-"+schoolId+"@example.test',password_hash,'Suite','Admin','"+role+"' FROM auth_db.users WHERE school_id='"+env.EDUOS_BOOTSTRAP_SCHOOL_ID+"' AND username='"+env.EDUOS_BOOTSTRAP_ADMIN_USERNAME.replaceAll("'","''")+"'; "+['Principal','Teacher','Parent','Student'].map(r=>"INSERT INTO auth_db.roles(id,school_id,name) VALUES(gen_random_uuid(),'"+schoolId+"','"+r+"');").join(' ')+" COMMIT;")
  api=await playwright.request.newContext({baseURL:process.env.EDUOS_TEST_URL||'http://localhost:8080'});await login('SuperAdmin')
  const roles=await good('GET','/roles')
  for(const role of ['Principal','Teacher','Parent','Student']){
   users[role]=(await good('POST','/users',{schoolId,roleId:roles.find((r:any)=>r.name===role).id,username:'suite.'+role.toLowerCase(),email:role.toLowerCase()+schoolId+'@example.test',firstName:role,lastName:'QA',password},'SuperAdmin',201)).id
   await login(role)
  }
 })
 test.afterAll(async()=>{
  await api?.dispose()
  const tables=['suite.documents','suite.acknowledgements','suite.payments','suite.charges','suite.student_classes','suite.records','suite.counters','school_db.attendance','student_db.students','teacher_db.teachers','parent_db.parents','school_db.announcements','auth_db.password_resets','auth_db.refresh_tokens','auth_db.users']
  sql("BEGIN; "+tables.map(t=>"DELETE FROM "+t+" WHERE school_id='"+schoolId+"';").join(' ')+" DELETE FROM auth_db.role_permissions WHERE role_id IN(SELECT id FROM auth_db.roles WHERE school_id='"+schoolId+"'); DELETE FROM auth_db.roles WHERE school_id='"+schoolId+"'; DELETE FROM school_db.schools WHERE id='"+schoolId+"'; DELETE FROM school_db.audit_logs WHERE school_id='"+schoolId+"'; DELETE FROM suite.audit WHERE school_id='"+schoolId+"'; COMMIT;")
  for(const id of docs)execFileSync('docker',['compose','exec','-T','school-service','rm','--','/app/documents/'+id.replaceAll('-','')+'.bin'],{cwd:root,stdio:'pipe'})
 })
 test('sets up academics and admits a student once, with class and guardian records',async()=>{
  expect((await good('GET','/suite/catalog')).length).toBe(19)
  year=await create('academic-years',{name:'2026-27',startsOn:'2026-04-01',endsOn:'2027-03-31',status:'Current'})
  expect((await req('POST','/suite/records/academic-years',{name:'Conflict',startsOn:'2026-04-01',endsOn:'2027-03-31',status:'Current'})).status()).toBe(409)
  teacher=(await good('POST','/teachers',{schoolId,employeeCode:'ST-1',firstName:'Maya',lastName:'Teacher',email:'maya'+schoolId+'@example.test',phoneNumber:'9000000002',department:'Science'},'SuperAdmin',201)).id
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
  expect((await good('GET','/suite/catalog',undefined,'Principal')).length).toBe(19)
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
 test('keeps fees exact, payments idempotent, receipts private and balances non-negative',async()=>{
  const structure=await create('fee-structures',{name:'Tuition',classId:cl,amount:1000.10,installment:'Term 1',dueDate:day})
  charge=(await good('POST','/suite/fees/charges',{studentId:student,structureId:structure,concession:100.05},'SuperAdmin',201)).id
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
  await page.goto('/students');await expect(page).toHaveURL(/\/suite$/)
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
  const roles=await good('GET','/roles',undefined,'Principal')
  const second=(await good('POST','/users',{schoolId,roleId:roles.find((r:any)=>r.name==='SuperAdmin').id,username:'suite.secondadmin',email:'second'+schoolId+'@example.test',firstName:'Second',lastName:'Admin',password},'Principal',201)).id
  const responses=await Promise.all([adminId,second].map(id=>req('PUT','/users/'+id,{isActive:false},'Principal')))
  expect(responses.map(r=>r.status()).sort()).toEqual([200,409])
 })

})
