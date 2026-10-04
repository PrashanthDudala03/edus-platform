import { seedIamSql, clearIamSql } from './iam-fixtures'
import {test,expect,APIRequestContext,APIResponse,Page} from '@playwright/test'
import {readFileSync,mkdirSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import path from 'node:path'
// Six-role acceptance tests. They sign in to the DEVELOPMENT demo school created by
//   node scripts/seed-demo.mjs --confirm-demo
// and build a separate, temporary School B through the platform API for cross-tenant attacks.
const root=path.resolve(import.meta.dirname,'../..')
const env=Object.fromEntries(readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(x=>x&&!x.startsWith('#')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)]}))
const DEMO_PASSWORD=process.env.EDUOS_DEMO_PASSWORD||'EduOS@Demo2026!!',testPassword=env.EDUOS_BOOTSTRAP_ADMIN_PASSWORD
const day=new Date().toISOString().slice(0,10),screens=path.join(root,'.local/screenshots')
const sql=(query:string)=>execFileSync('docker',['compose','exec','-T','postgres','psql','-U',env.POSTGRES_USER,'-d',env.POSTGRES_DB,'-v','ON_ERROR_STOP=1','-At','-c',query],{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe']})
type Role='SuperAdmin'|'Administrator'|'Principal'|'Teacher'|'Parent'|'Student'
const demo:Record<Role,{user:string,home:string,heading:RegExp,has:string[],lacks:string[]}>={
 SuperAdmin:{user:'superadmin@eduos.local',home:'/super-admin',heading:/Platform overview/,has:['Schools'],lacks:['Student records','All school modules']},
 Administrator:{user:'admin@demo.eduos.local',home:'/admin',heading:/^Good (morning|afternoon|evening), Asha\.$/,has:['School settings & accounts','Fees & collections','Fee heads','Fee structures & instalments','Class allocation & promotion'],lacks:['Schools']},
 Principal:{user:'principal@demo.eduos.local',home:'/principal',heading:/^Good (morning|afternoon|evening), Meera\.$/,has:['Staff attendance','Fees (view only)','Leave approvals','Fee structures & instalments'],lacks:['School settings & accounts','Access control','Class allocation & promotion']},
 Teacher:{user:'teacher@demo.eduos.local',home:'/teacher',heading:/^Welcome, Ravi\.$/,has:['My classes','Attendance','Marks'],lacks:['Fees & receipts','Student records','School settings & accounts']},
 Parent:{user:'parent@demo.eduos.local',home:'/parent',heading:/^Hello, Neha\.$/,has:['Fees & receipts','Results','Documents & certificates'],lacks:['Student records','Attendance','Marks']},
 Student:{user:'student@demo.eduos.local',home:'/student',heading:/^Hi, Aarav\.$/,has:['My results','My submissions','Timetable','Fees & receipts'],lacks:['Access control','Student records','Attendance']},
}
const roles=Object.keys(demo) as Role[]
const forbidden='This area isn’t available for your role'
let api:APIRequestContext
const tokens:Record<string,any>={}
const ids:Record<string,string>={}
const B={id:'',name:'Role QA B '+randomUUID().slice(0,6),tag:randomUUID().slice(0,6)}

// nginx allows 10 sign-ins a minute per client (burst 10); wait out a 429 rather than fail.
async function throttled(send:()=>Promise<APIResponse>){for(let i=0;;i++){const r=await send();if(r.status()!==429||i>=15)return r;await new Promise(f=>setTimeout(f,6500))}}
async function login(key:string,username:string,password:string,schoolId=''){const r=await throttled(()=>api.post('/api/v1/auth/login',{data:{username,password,schoolId}}));expect(r.status(),key+': '+await r.text()).toBe(200);tokens[key]=(await r.json()).data;return tokens[key]}
const call=(who:string,method:string,url:string,body?:any,headers:Record<string,string>={})=>api.fetch('/api/v1'+url,{method,headers:{Authorization:'Bearer '+tokens[who].accessToken,...headers},...(body===undefined?{}:{data:body})})
async function ok(who:string,method:string,url:string,body?:any,status=200){const r=await call(who,method,url,body);expect(r.status(),who+' '+method+' '+url+' '+await r.text()).toBe(status);return(await r.json()).data}
async function expectStatus(who:string,method:string,url:string,expected:number|number[],body?:any,headers?:Record<string,string>){const r=await call(who,method,url,body,headers);const text=await r.text();expect([expected].flat(),who+' '+method+' '+url+' got '+r.status()+' '+text.slice(0,200)).toContain(r.status());return text}
async function uiLogin(page:Page,username:string,password:string){
 for(let i=0;i<15;i++){
  await page.goto('/login');await page.getByLabel('Email or username',{exact:true}).fill(username);await page.getByLabel('Password',{exact:true}).fill(password)
  await page.getByRole('button',{name:'Sign in to workspace'}).click()
  const outcome=await Promise.race([page.waitForURL(u=>!u.pathname.startsWith('/login'),{timeout:15000}).then(()=>'ok').catch(()=>''),page.getByText('Too many sign-in attempts').waitFor({timeout:15000}).then(()=>'throttled').catch(()=>'')])
  if(outcome==='ok')return
  if(outcome!=='throttled')throw Error('Sign-in did not complete for '+username)
  await page.waitForTimeout(6500)
 }
}
async function session(page:Page,who:string){await page.addInitScript(s=>{localStorage.setItem('accessToken',s.accessToken);localStorage.setItem('refreshToken',s.refreshToken);localStorage.setItem('user',JSON.stringify(s.user))},tokens[who])}
const noOverflow=(page:Page)=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)

test.describe.serial('Six role portals against the seeded demo school',()=>{
 test.describe.configure({timeout:180000})
 test.beforeAll(async({playwright})=>{
  test.setTimeout(420000)
  api=await playwright.request.newContext({baseURL:process.env.EDUOS_TEST_URL||'http://localhost:8080'})
  for(const role of roles){
   const r=await throttled(()=>api.post('/api/v1/auth/login',{data:{username:demo[role].user,password:DEMO_PASSWORD}}))
   if(r.status()!==200)throw Error('Demo account '+demo[role].user+' cannot sign in ('+r.status()+'). Run: node scripts/seed-demo.mjs --confirm-demo')
   tokens[role]=(await r.json()).data
  }
  ids.demoSchool=tokens.Administrator.user.schoolId
  const kids=(await ok('Parent','GET','/suite/options')).students
  ids.aarav=kids.find((k:any)=>k.label.startsWith('Aarav')).id;ids.diya=kids.find((k:any)=>k.label.startsWith('Diya')).id
  const classes=(await ok('Administrator','GET','/suite/records/classes')).data
  ids.grade3=classes.find((c:any)=>c.name==='Grade 3').id;ids.grade6=classes.find((c:any)=>c.name==='Grade 6').id
  ids.readingLog=(await ok('Administrator','GET','/suite/records/homework')).data.find((h:any)=>h.title==='Reading log (Demo)').id
  ids.demoCircular=(await ok('Administrator','GET','/suite/records/circulars')).data[0].id
  ids.english=(await ok('Administrator','GET','/suite/records/subjects')).data.find((s:any)=>s.code==='ENG').id

  // School B: created by the platform SuperAdmin, then filled by its own administrator.
  B.id=(await ok('SuperAdmin','POST','/platform/schools',{name:B.name,principalName:'QA Principal B'},201)).id
  await ok('SuperAdmin','POST','/platform/schools/'+B.id+'/administrators',{username:'qa.admin.'+B.tag,email:'admin-'+B.tag+'@example.test',firstName:'QA',lastName:'Admin B',password:testPassword},201)
  await login('adminB','qa.admin.'+B.tag,testPassword,B.id)
  const rolesB=Object.fromEntries((await ok('adminB','GET','/roles')).map((r:any)=>[r.name,r.id]))
  for(const who of ['parentB1','parentB2'])ids[who]=(await ok('adminB','POST','/users',{schoolId:B.id,roleId:rolesB.Parent,username:who+'.'+B.tag,email:who+'-'+B.tag+'@example.test',firstName:who,lastName:'Bravo',password:testPassword},201)).id
  const create=async(kind:string,body:any)=>(await ok('adminB','POST','/suite/records/'+kind,body,201)).id
  const year=await create('academic-years',{name:'B year',startsOn:'2026-04-01',endsOn:'2027-03-31',status:'Current'})
  ids.teacherB=(await ok('adminB','POST','/teachers',{schoolId:B.id,employeeCode:'B-'+B.tag,firstName:'Bianca',lastName:'Bravo',email:'teacher-'+B.tag+'@example.test',phoneNumber:'9000000301',department:'Science'},201)).id
  ids.classB=await create('classes',{name:'Grade 5',section:'Q',yearId:year,teacherId:ids.teacherB,capacity:30})
  const subject=await create('subjects',{name:'Science',code:'SCI'})
  await create('teaching-assignments',{classId:ids.classB,subjectId:subject,teacherId:ids.teacherB})
  // Guardian email and phone are unique across the whole database, so each guardian gets fresh values.
  const stamp=String(Date.now()).slice(-8),phones:Record<string,string>={parentB1:'91'+stamp,parentB2:'92'+stamp}
  const admit=async(no:string,first:string,last:string,guardian:string)=>{const id=await create('admissions',{admissionNumber:no,firstName:first,lastName:last,dateOfBirth:'2015-02-02',gender:'Female',email:no.toLowerCase()+'-'+B.tag+'@example.test',phoneNumber:'9000000302',guardianName:'Guardian '+last,guardianEmail:guardian+'-'+B.tag+'@example.test',guardianPhone:phones[guardian],address:'B street',classId:ids.classB,status:'Submitted'});ids['adm'+no]=id;return(await ok('adminB','POST','/suite/admissions/'+id+'/accept')).studentId}
  ids.childB1=await admit('B1','Zoya','Bravo','parentB1');ids.childB2=await admit('B2','Kabir','Bravo','parentB1');ids.childB3=await admit('B3','Ishaan','Charlie','parentB2')
  await create('account-links',{userId:ids.parentB1,studentId:ids.childB1});await create('account-links',{userId:ids.parentB1,studentId:ids.childB2});await create('account-links',{userId:ids.parentB2,studentId:ids.childB3})
  ids.circularB=await create('circulars',{title:'Bravo notice',message:'For school B only.',audience:'All',dueDate:day})
  ids.homeworkB=await create('homework',{title:'Bravo homework',classId:ids.classB,subjectId:subject,dueDate:day,instructions:'B only.'})
  ids.certificateB=await create('certificates',{studentId:ids.childB1,type:'Bonafide certificate',issuedOn:day,remarks:'B only.'})
  const upload=await api.post('/api/v1/suite/documents?recordId='+ids.admB1,{headers:{Authorization:'Bearer '+tokens.adminB.accessToken},multipart:{file:{name:'b.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nBravo\n%%EOF')}}})
  expect(upload.status(),await upload.text()).toBe(201);ids.documentB=(await upload.json()).data.id
  const structure=await create('fee-structures',{name:'B fee',classId:ids.classB,amount:'500',installment:'1',dueDate:day})
  await ok('adminB','POST','/suite/fees/charges',{studentId:ids.childB1,structureId:structure,concession:'0'},201)
  await login('parentB1','parentB1.'+B.tag,testPassword,B.id);await login('parentB2','parentB2.'+B.tag,testPassword,B.id)
 })
 test.afterAll(async()=>{
  await api?.dispose()
  if(!B.id)return
  const tables=['suite.documents','suite.acknowledgements','suite.payments','suite.charges','suite.student_classes','suite.records','suite.counters','school_db.attendance','student_db.students','teacher_db.teachers','parent_db.parents','school_db.announcements','auth_db.password_resets','auth_db.refresh_tokens','auth_db.users']
  sql("BEGIN; "+clearIamSql(B.id)+tables.map(t=>"DELETE FROM "+t+" WHERE school_id='"+B.id+"';").join(' ')+" DELETE FROM auth_db.role_permissions WHERE role_id IN(SELECT id FROM auth_db.roles WHERE school_id='"+B.id+"'); DELETE FROM auth_db.roles WHERE school_id='"+B.id+"'; DELETE FROM school_db.schools WHERE id='"+B.id+"'; DELETE FROM school_db.audit_logs WHERE school_id='"+B.id+"'; DELETE FROM suite.audit WHERE school_id='"+B.id+"'; COMMIT;")
  if(ids.documentB)execFileSync('docker',['compose','exec','-T','school-service','rm','-f','--','/app/documents/'+ids.documentB.replaceAll('-','')+'.bin'],{cwd:root,stdio:'pipe'})
 })

 test('each demo account signs in on the one login page and lands on its own portal',async({browser})=>{
  mkdirSync(screens,{recursive:true})
  for(const role of roles){
   const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors:string[]=[]
   page.on('pageerror',e=>errors.push(e.message))
   await uiLogin(page,demo[role].user,DEMO_PASSWORD)
   await expect(page,role).toHaveURL(new RegExp(demo[role].home.replace('/','\\/')+'$'))
   await expect(page.getByRole('heading',{level:1,name:demo[role].heading})).toBeVisible()
   const nav=page.getByRole('navigation',{name:'Main navigation'})
   for(const item of demo[role].has)await expect(nav.getByRole('link',{name:item,exact:true}),role+' should see '+item).toBeVisible()
   for(const item of demo[role].lacks)await expect(nav.getByRole('link',{name:item,exact:true}),role+' should not see '+item).toHaveCount(0)
   // Every dashboard figure loaded from an endpoint this role may call: no refusal alerts.
   await expect(page.locator('.stat-card').first()).toBeVisible();await page.waitForLoadState('networkidle')
   await expect(page.locator('[role="alert"]'),role+' dashboard shows an error').toHaveCount(0)
   expect(await noOverflow(page)).toBe(true)
   await page.screenshot({path:path.join(screens,'role-'+role.toLowerCase()+'-desktop.png'),fullPage:true})
   await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Good to see you.'})).toBeVisible()
   expect(errors,role).toEqual([]);await context.close()
  }
 })

 test('opening another role’s portal by URL shows the 403 page',async({browser})=>{
  const pages=['/super-admin','/super-admin/schools','/admin','/settings','/principal','/teacher','/parent','/student','/students','/suite','/suite/allocation']
  const allowed:Record<Role,string[]>={SuperAdmin:['/super-admin','/super-admin/schools'],Administrator:['/admin','/settings','/students','/suite','/suite/allocation'],Principal:['/principal','/students','/suite'],Teacher:['/teacher','/suite'],Parent:['/parent','/suite'],Student:['/student','/suite']}
  for(const role of roles){
   const context=await browser.newContext(),page=await context.newPage();await session(page,role)
   for(const url of pages){
    await page.goto(url)
    if(allowed[role].includes(url))await expect(page.getByRole('heading',{name:forbidden}),role+' '+url).toHaveCount(0)
    else await expect(page.getByRole('heading',{name:forbidden}),role+' '+url).toBeVisible()
   }
   await page.goto('/');await expect(page).toHaveURL(new RegExp(demo[role].home.replace('/','\\/')+'$'))
   await context.close()
  }
 })

 test('the API enforces each role’s permissions regardless of the interface',async()=>{
  const S=ids.demoSchool
  const matrix:[Role,string,string,number|number[],any?][]=[
   ['SuperAdmin','GET','/platform/overview',200],['SuperAdmin','GET','/platform/schools',200],['SuperAdmin','GET','/students',403],['SuperAdmin','GET','/suite/catalog',403],['SuperAdmin','GET','/users',403],['SuperAdmin','GET','/operations/overview?day='+day,403],['SuperAdmin','GET','/schools/'+S,403],
   ['Administrator','GET','/platform/overview',403],['Administrator','POST','/platform/schools',403,{name:'Nope'}],['Administrator','PUT','/platform/schools/'+S,403,{isActive:false}],['Administrator','GET','/users',200],['Administrator','GET','/roles',200],['Administrator','GET','/students',200],['Administrator','GET','/suite/reports/audit',200],['Administrator','GET','/suite/fees',200],
   ['Principal','GET','/platform/overview',403],['Principal','GET','/users',403],['Principal','POST','/users',403,{}],['Principal','GET','/roles',403],['Principal','PUT','/users/'+tokens.Teacher.user.id,403,{isActive:false}],['Principal','PUT','/users/'+tokens.Teacher.user.id,403,{roleId:randomUUID()}],['Principal','POST','/users/'+tokens.Teacher.user.id+'/recovery-code',403],
   ['Principal','GET','/students',200],['Principal','GET','/teachers',200],['Principal','GET','/parents',200],['Principal','POST','/students',403,{}],['Principal','DELETE','/students/'+ids.aarav,403],['Principal','GET','/schools/'+S,200],['Principal','PUT','/schools/'+S,403,{name:'Renamed'}],
   ['Principal','GET','/suite/fees',200],['Principal','POST','/suite/fees/charges',403,{}],['Principal','POST','/suite/fees/payments',403,{}],['Principal','POST','/suite/fees/'+randomUUID()+'/remind',403],['Principal','POST','/suite/records/fee-structures',403,{}],['Principal','POST','/suite/records/school-config',403,{}],['Principal','POST','/suite/records/classes',403,{}],['Principal','POST','/suite/records/account-links',403,{}],['Principal','POST','/suite/imports/students',403,{rows:[{}],commit:false}],['Principal','POST','/suite/allocate',403,{studentIds:[ids.aarav],classId:ids.grade6}],['Principal','DELETE','/suite/records/circulars/'+ids.demoCircular,403],
   ['Principal','GET','/suite/reports/audit',200],['Principal','GET','/suite/records/account-links',200],['Principal','GET','/operations/overview?day='+day,200],['Principal','GET','/suite/report-cards/'+ids.diya,200],
   ['Teacher','GET','/users',403],['Teacher','GET','/students',403],['Teacher','GET','/operations/overview?day='+day,403],['Teacher','GET','/suite/fees',403],['Teacher','POST','/suite/records/exams',403,{}],['Teacher','POST','/suite/fees/charges',403,{}],['Teacher','GET','/platform/overview',403],['Teacher','GET','/suite/student-attendance?day='+day,200],
   ['Teacher','GET','/suite/report-cards/'+ids.aarav,200],['Teacher','GET','/suite/report-cards/'+ids.diya,403],['Teacher','POST','/suite/records/homework',403,{title:'Not my class',classId:ids.grade3,subjectId:ids.english,dueDate:day,instructions:'x'}],['Teacher','POST','/suite/student-attendance',403,{day,entries:[{studentId:ids.diya,status:'Absent'}]}],
   ['Parent','GET','/suite/report-cards/'+ids.aarav,200],['Parent','GET','/suite/report-cards/'+ids.diya,200],['Parent','GET','/users',403],['Parent','GET','/students',403],['Parent','GET','/suite/student-attendance?day='+day,403],['Parent','POST','/suite/records/circulars',403,{}],['Parent','GET','/platform/overview',403],
   ['Student','GET','/suite/report-cards/'+ids.aarav,200],['Student','GET','/suite/report-cards/'+ids.diya,403],['Student','GET','/users',403],['Student','POST','/suite/records/marks',403,{}],['Student','POST','/suite/records/submissions',403,{homeworkId:ids.readingLog,studentId:ids.diya,response:'Not mine'}],['Student','GET','/platform/overview',403],
  ]
  for(const [role,method,url,expected,body] of matrix)await expectStatus(role,method,url,expected,body)
  // Principal writes academic oversight records; the administrator can archive them.
  const event=(await ok('Principal','POST','/suite/records/calendar',{title:'Principal QA event',startsOn:day,endsOn:day,description:'Created by the role tests.'},201)).id
  await ok('Administrator','DELETE','/suite/records/calendar/'+event)
 })

 test('children stay private to their own family, inside one school and across schools',async()=>{
  // Demo school: the student account sees only itself, never the sibling.
  expect((await ok('Student','GET','/suite/options')).students.map((s:any)=>s.id)).toEqual([ids.aarav])
  expect((await ok('Student','GET','/suite/allocations')).map((a:any)=>a.studentId)).toEqual([ids.aarav])
  expect((await ok('Student','GET','/suite/fees')).every((f:any)=>f.studentId===ids.aarav)).toBe(true)
  expect((await ok('Student','GET','/suite/records/certificates')).data.every((c:any)=>c.studentId===ids.aarav)).toBe(true)
  // School B: parent B2 must not reach parent B1's children by id, query, body or headers.
  expect((await ok('parentB2','GET','/suite/options')).students.map((s:any)=>s.id)).toEqual([ids.childB3])
  expect((await ok('parentB1','GET','/suite/options')).students.map((s:any)=>s.id).sort()).toEqual([ids.childB1,ids.childB2].sort())
  await expectStatus('parentB2','GET','/suite/report-cards/'+ids.childB1,403)
  await expectStatus('parentB2','GET','/suite/report-cards/'+ids.childB1+'?studentId='+ids.childB3,403)
  await expectStatus('parentB2','GET','/suite/documents/'+ids.documentB,[403,404]);await expectStatus('parentB2','GET','/suite/documents?recordId='+ids.admB1,[403,404])
  await expectStatus('parentB2','GET','/suite/certificates/'+ids.certificateB+'/print',403)
  await expectStatus('parentB2','POST','/suite/records/submissions',403,{homeworkId:ids.homeworkB,studentId:ids.childB1,response:'Pretending'})
  await expectStatus('parentB2','GET','/suite/report-cards/'+ids.childB1,403,undefined,{'X-EduOS-Role':'Administrator','X-EduOS-User':tokens.adminB.user.id})
  expect((await ok('parentB2','GET','/suite/fees')).every((f:any)=>f.studentId===ids.childB3)).toBe(true)
  expect((await ok('parentB2','GET','/suite/records/certificates')).data).toEqual([])
 })

 test('demo school roles cannot read or change school B by id, query, body or header',async()=>{
  const spoof={'X-EduOS-School':B.id,'X-EduOS-Role':'Administrator'}
  const attempts:[Role,string,string,number[],any?][]=[
   ['Administrator','GET','/schools/'+B.id,[403]],['Administrator','GET','/students?schoolId='+B.id,[403]],['Administrator','PUT','/students/'+ids.childB1,[404],{id:ids.childB1,firstName:'X',lastName:'Y',email:'x@example.test',currentClass:'Z',dateOfBirth:'2015-02-02T00:00:00Z',status:'Active'}],['Administrator','DELETE','/teachers/'+ids.teacherB,[404]],['Administrator','PUT','/users/'+ids.parentB1,[404],{isActive:false}],['Administrator','POST','/users/'+ids.parentB1+'/recovery-code',[404]],['Administrator','GET','/suite/documents/'+ids.documentB,[404]],['Administrator','POST','/suite/admissions/'+ids.admB1+'/accept',[404]],['Administrator','POST','/students',[403],{schoolId:B.id,rollNumber:'X',firstName:'X',lastName:'X',email:'x@example.test',currentClass:'X',dateOfBirth:'2014-01-01'}],
   ['Principal','GET','/schools/'+B.id,[403]],['Principal','GET','/suite/report-cards/'+ids.childB1,[404]],['Principal','GET','/suite/certificates/'+ids.certificateB+'/print',[404]],['Principal','GET','/suite/circulars/'+ids.circularB+'/acknowledgements',[404]],
   ['Teacher','POST','/suite/records/homework',[404],{title:'Cross',classId:ids.classB,subjectId:ids.english,dueDate:day,instructions:'x'}],['Teacher','GET','/suite/report-cards/'+ids.childB1,[403]],['Teacher','POST','/suite/student-attendance',[403],{day,entries:[{studentId:ids.childB1,status:'Present'}]}],
   ['Parent','GET','/suite/report-cards/'+ids.childB1,[403]],['Parent','GET','/suite/documents/'+ids.documentB,[404]],['Parent','POST','/suite/circulars/'+ids.circularB+'/acknowledge',[404]],
   ['Student','GET','/suite/report-cards/'+ids.childB3,[403]],['Student','POST','/suite/records/submissions',[404],{homeworkId:ids.homeworkB,studentId:ids.childB1,response:'x'}],['Student','GET','/suite/catalog?schoolId='+B.id,[403]],
  ]
  for(const [role,method,url,expected,body] of attempts){
   const text=await expectStatus(role,method,url,expected,body,spoof)
   expect(text,role+' '+url+' leaked school B data').not.toMatch(/Bravo|Charlie|Zoya|Kabir|Ishaan/)
  }
  // Nothing school B owns appears in any demo role's lists.
  for(const role of ['Administrator','Principal','Teacher','Parent','Student'] as Role[])
   for(const url of ['/suite/records/circulars','/suite/records/homework','/suite/options','/suite/allocations'])expect(await expectStatus(role,'GET',url,200),role+' '+url).not.toMatch(/Bravo|Charlie|Zoya|Kabir|Ishaan/)
 })

 test('the SuperAdmin manages schools; deactivating one signs its users out and blocks sign-in',async({page})=>{
  await session(page,'SuperAdmin');await page.goto('/super-admin/schools')
  await page.getByLabel('Search schools').fill(B.name);await expect(page.getByRole('button',{name:'Deactivate'})).toHaveCount(1);await expect(page.getByRole('cell',{name:new RegExp('^'+B.name)})).toBeVisible()
  await page.getByRole('button',{name:'View '+B.name}).click();await expect(page.getByText(B.id)).toBeVisible();await page.getByRole('button',{name:'Close dialog'}).click()
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Deactivate'}).click();await expect(page.getByText('School deactivated. Its users have been signed out.')).toBeVisible()
  await expectStatus('adminB','GET','/students',401);await expectStatus('parentB1','GET','/suite/options',401)
  const blocked=await throttled(()=>api.post('/api/v1/auth/login',{data:{username:'qa.admin.'+B.tag,password:testPassword,schoolId:B.id}}))
  expect(blocked.status()).toBe(403);expect((await blocked.json()).message).toContain('deactivated')
  await page.getByLabel('Filter by status').selectOption('inactive');await expect(page.getByRole('button',{name:'Activate'})).toHaveCount(1);page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Activate'}).click();await expect(page.getByText('School saved.')).toBeVisible()
  // Re-activation does not revive the sessions that deactivation ended.
  await expectStatus('adminB','GET','/students',401)
  await login('adminB','qa.admin.'+B.tag,testPassword,B.id);await login('parentB1','parentB1.'+B.tag,testPassword,B.id);await login('parentB2','parentB2.'+B.tag,testPassword,B.id)
  expect((await ok('adminB','GET','/students/count')).count).toBe(3)
 })

 test('the sign-in page explains disabled accounts and ended sessions',async({page})=>{
  await ok('adminB','PUT','/users/'+ids.parentB2,{isActive:false})
  await page.goto('/login');await page.getByLabel('Email or username',{exact:true}).fill('parentB2.'+B.tag);await page.getByLabel('Password',{exact:true}).fill(testPassword)
  await page.getByText('Signing in to another school?').click();await page.getByLabel('School ID',{exact:true}).fill(B.id)
  await page.getByRole('button',{name:'Sign in to workspace'}).click();await expect(page.getByRole('alert')).toContainText(/disabled|Too many/)
  await page.getByLabel('Password',{exact:true}).fill('definitely-not-the-password')
  await page.getByRole('button',{name:'Sign in to workspace'}).click();await expect(page.getByRole('alert')).toContainText(/incorrect|Too many/)
  // A session that can no longer refresh returns to sign-in with a notice.
  await session(page,'parentB2');await page.goto('/parent');await expect(page.getByText('Your session has ended. Please sign in again.')).toBeVisible()
  await ok('adminB','PUT','/users/'+ids.parentB2,{isActive:true})
 })

 test('every portal works on desktop, tablet and phone without sideways scrolling',async({browser})=>{
  for(const [name,viewport] of [['desktop',{width:1440,height:900}],['tablet',{width:820,height:1180}],['mobile',{width:390,height:844}]] as const){
   for(const role of roles){
    const context=await browser.newContext({viewport}),page=await context.newPage();await session(page,role);await page.goto(demo[role].home)
    await expect(page.getByRole('heading',{level:1,name:demo[role].heading})).toBeVisible();await page.waitForLoadState('networkidle')
    expect(await noOverflow(page),role+' '+name).toBe(true)
    if(name==='mobile'){
     await page.getByRole('button',{name:'Open navigation'}).click();await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:demo[role].has[0],exact:true})).toBeVisible()
     await page.locator('.mobile-close').click();await expect(page.locator('.sidebar.is-open')).toHaveCount(0)
     await page.screenshot({path:path.join(screens,'role-'+role.toLowerCase()+'-mobile.png'),fullPage:true})
    }
    await context.close()
   }
  }
  // The parent's child switcher works on a phone and changes the whole view.
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();await session(page,'Parent');await page.goto('/parent')
  await expect(page.getByRole('heading',{level:2,name:/Aarav/})).toBeVisible()
  await page.getByLabel('Choose child').selectOption(ids.diya);await expect(page.getByRole('heading',{level:2,name:/Diya/})).toBeVisible();await expect(page.locator('.child-profile').getByText('Grade 3 - B')).toBeVisible()
  expect(await noOverflow(page)).toBe(true);await context.close()
 })

 test('sign-out revokes the refresh token',async()=>{
  const fresh=await login('studentLogout',demo.Student.user,DEMO_PASSWORD)
  expect((await api.post('/api/v1/auth/logout',{headers:{Authorization:'Bearer '+fresh.accessToken},data:{refreshToken:fresh.refreshToken}})).status()).toBe(200)
  expect((await api.post('/api/v1/auth/refresh',{data:{refreshToken:fresh.refreshToken}})).status()).toBe(401)
 })
})
