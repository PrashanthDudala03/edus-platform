import { test, expect, APIRequestContext, APIResponse } from '@playwright/test'
import { readFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
const root=path.resolve(import.meta.dirname,'../..')
const env=Object.fromEntries(readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(x=>x&&!x.startsWith('#')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)]}))
const schoolId=randomUUID(),userId=randomUUID(),roleId=randomUUID()
const otherSchool=env.EDUOS_BOOTSTRAP_SCHOOL_ID
let token='',refresh='',studentId='',api:APIRequestContext
const password=env.EDUOS_BOOTSTRAP_ADMIN_PASSWORD
const sql=(query:string)=>execFileSync('docker',['compose','exec','-T','postgres','psql','-U',env.POSTGRES_USER,'-d',env.POSTGRES_DB,'-v','ON_ERROR_STOP=1','-c',query],{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe']})
const headers=()=>({Authorization:'Bearer '+token})
// nginx limits login to 10/min per client (burst 10); wait out a 429 when earlier specs used the budget.
async function throttled(send:()=>Promise<APIResponse>){for(let i=0;;i++){const r=await send();if(r.status()!==429||i>=15)return r;await new Promise(f=>setTimeout(f,6500))}}
const student={schoolId,rollNumber:'QA-001',firstName:'Aarav',lastName:'TestStudent',email:'aarav@example.test',phoneNumber:'9000000001',currentClass:'Grade 6 - A',dateOfBirth:'2014-03-12T00:00:00Z'}
const date=new Date().toISOString().slice(0,10)
test.describe.serial('School workspace against real Docker services',()=>{
 test.beforeAll(async({playwright})=>{
  test.setTimeout(180000)
  sql("BEGIN; INSERT INTO school_db.schools(id,name) VALUES('"+schoolId+"','QA School'); INSERT INTO auth_db.roles(id,school_id,name) VALUES('"+roleId+"','"+schoolId+"','SuperAdmin'); INSERT INTO auth_db.roles(id,school_id,name) VALUES(gen_random_uuid(),'"+schoolId+"','Principal'); INSERT INTO auth_db.users(id,school_id,username,email,password_hash,first_name,last_name,role_id) SELECT '"+userId+"','"+schoolId+"','qa.admin','qa-"+schoolId+"@example.test',password_hash,'QA','Administrator','"+roleId+"' FROM auth_db.users WHERE school_id='"+otherSchool+"' AND username='"+env.EDUOS_BOOTSTRAP_ADMIN_USERNAME.replaceAll("'","''")+"'; COMMIT;")
  api=await playwright.request.newContext({baseURL:process.env.EDUOS_TEST_URL||'http://localhost:8080'})
  const response=await throttled(()=>api.post('/api/v1/auth/login',{data:{username:'qa.admin',password,schoolId}}))
  expect(response.status()).toBe(200)
  const login=(await response.json()).data;token=login.accessToken;refresh=login.refreshToken
 })
 test.afterAll(async()=>{
  await api?.dispose()
  // Remove only this run's isolated, randomly named QA tenant and records.
  sql("BEGIN; DELETE FROM school_db.attendance WHERE school_id='"+schoolId+"'; DELETE FROM student_db.students WHERE school_id='"+schoolId+"'; DELETE FROM teacher_db.teachers WHERE school_id='"+schoolId+"'; DELETE FROM parent_db.parents WHERE school_id='"+schoolId+"'; DELETE FROM school_db.announcements WHERE school_id='"+schoolId+"'; DELETE FROM auth_db.refresh_tokens WHERE school_id='"+schoolId+"'; DELETE FROM auth_db.users WHERE school_id='"+schoolId+"'; DELETE FROM auth_db.role_permissions WHERE role_id IN(SELECT id FROM auth_db.roles WHERE school_id='"+schoolId+"'); DELETE FROM auth_db.roles WHERE school_id='"+schoolId+"'; DELETE FROM school_db.schools WHERE id='"+schoolId+"'; DELETE FROM school_db.audit_logs WHERE school_id='"+schoolId+"'; COMMIT;")
 })
 test('protects anonymous routes, school scope, malformed JSON, and duplicate scope',async()=>{
  expect((await api.get('/api/v1/students')).status()).toBe(401)
  expect((await api.get('/api/v1/students?schoolId='+otherSchool,{headers:headers()})).status()).toBe(403)
  expect((await api.get('/api/v1/schools/'+otherSchool,{headers:headers()})).status()).toBe(403)
  expect((await api.post('/api/v1/students',{headers:headers(),data:{...student,schoolId:otherSchool}})).status()).toBe(403)
  expect((await api.post('/api/v1/students',{headers:{...headers(),'Content-Type':'application/json'},data:'{bad json'})).status()).toBe(400)
  expect((await api.post('/api/v1/students',{headers:headers(),data:{...student,SchoolId:schoolId}})).status()).toBe(400)
  expect((await api.get('/api/v1/students?pageSize=10000',{headers:headers()})).status()).toBe(400)
 })
 test('creates, validates, searches, and updates students with birth date intact',async()=>{
  const created=await api.post('/api/v1/students',{headers:headers(),data:student})
  expect(created.status(),await created.text()).toBe(201);studentId=(await created.json()).data.id
  expect((await api.post('/api/v1/students',{headers:headers(),data:student})).status()).toBe(409)
  const updated=await api.put('/api/v1/students/'+studentId,{headers:headers(),data:{...student,id:studentId,status:'Active',currentClass:'Grade 7 - A'}})
  expect(updated.status(),await updated.text()).toBe(200)
  const directory=(await (await api.get('/api/v1/operations/directory/students?search=Aarav',{headers:headers()})).json()).data
  expect(directory.totalCount).toBe(1);expect(directory.data[0].currentClass).toBe('Grade 7 - A')
  expect(directory.data[0].dateOfBirth.slice(0,10)).toBe('2014-03-12')
 })
 test('persists attendance corrections and rejects foreign students atomically',async()=>{
  expect((await api.post('/api/v1/operations/attendance',{headers:headers(),data:{day:date,entries:[{studentId,status:'Present'}]}})).status()).toBe(200)
  expect((await api.post('/api/v1/operations/attendance',{headers:headers(),data:{day:date,entries:[{studentId,status:'Late'}]}})).status()).toBe(200)
  expect((await api.post('/api/v1/operations/attendance',{headers:headers(),data:{day:date,entries:[{studentId,status:'Absent'},{studentId:randomUUID(),status:'Present'}]}})).status()).toBe(400)
  const rows=(await (await api.get('/api/v1/operations/attendance?day='+date,{headers:headers()})).json()).data.data
  expect(rows.find((s:any)=>s.id===studentId).status).toBe('Late')
  expect((await api.post('/api/v1/operations/attendance',{headers:headers(),data:{day:date,entries:[{studentId,status:'Invalid'}]}})).status()).toBe(400)
 })
 test('manages teachers and guardians and archives records',async()=>{
  for(const [kind,data]of Object.entries({teachers:{schoolId,employeeCode:'QA-T1',firstName:'Maya',lastName:'Teacher',email:'teacher-'+schoolId+'@example.test',phoneNumber:'9000000002',department:'Science'},parents:{schoolId,firstName:'Priya',lastName:'Guardian',email:'parent-'+schoolId+'@example.test',phoneNumber:'9'+Date.now().toString().slice(-9)}})){
   const created=await api.post('/api/v1/'+kind,{headers:headers(),data});expect(created.status(),await created.text()).toBe(201)
   const id=(await created.json()).data.id
   expect((await api.put('/api/v1/'+kind+'/'+id,{headers:headers(),data:{...data,id,status:'Active',firstName:'Updated'}})).status()).toBe(200)
   expect((await api.delete('/api/v1/'+kind+'/'+id,{headers:headers()})).status()).toBe(200)
   const rows=(await(await api.get('/api/v1/operations/directory/'+kind,{headers:headers()})).json()).data
   expect(rows.totalCount).toBe(0)
  }
 })
 test('publishes notices, reports real totals, and records changes',async()=>{
  const created=await api.post('/api/v1/operations/announcements',{headers:headers(),data:{title:'Welcome to the new term',body:'A shared update for the school administration team.',priority:'Important'}})
  expect(created.status()).toBe(201)
  const stats=(await(await api.get('/api/v1/operations/overview?day='+date,{headers:headers()})).json()).data.stats
  expect(stats.students).toBe(1);expect(stats.teachers).toBe(0);expect(stats.present).toBe(1)
  const audit=(await(await api.get('/api/v1/operations/audit',{headers:headers()})).json()).data
  expect(audit.data.some((r:any)=>r.entityType==='attendance')).toBeTruthy()
  expect(audit.data.some((r:any)=>r.entityType==='announcements')).toBeTruthy()
 })
 test('rotates refresh tokens once even under concurrent requests',async()=>{
  const responses=await Promise.all([1,2].map(()=>api.post('/api/v1/auth/refresh',{data:{refreshToken:refresh}})))
  expect(responses.map(r=>r.status()).sort()).toEqual([200,401])
  const good=responses.find(r=>r.status()===200)!
  const result=(await good.json()).data;token=result.accessToken;refresh=result.refreshToken
  expect((await api.get('/api/v1/students',{headers:headers()})).status()).toBe(200)
 })
 test('disables staff immediately and protects the last school administrator',async()=>{
  const roles=(await(await api.get('/api/v1/roles',{headers:headers()})).json()).data
  const principal=roles.find((r:any)=>r.name==='Principal')
  const created=await api.post('/api/v1/users',{headers:headers(),data:{schoolId,roleId:principal.id,username:'qa.principal',firstName:'QA',lastName:'Principal',email:'principal-'+schoolId+'@example.test',password}})
  expect(created.status(),await created.text()).toBe(201)
  const id=(await created.json()).data.id
  const login=await throttled(()=>api.post('/api/v1/auth/login',{data:{schoolId,username:'qa.principal',password}}))
  expect(login.status()).toBe(200);const session=(await login.json()).data
  expect((await api.put('/api/v1/users/'+id,{headers:headers(),data:{isActive:false}})).status()).toBe(200)
  expect((await api.get('/api/v1/students',{headers:{Authorization:'Bearer '+session.accessToken}})).status()).toBe(401)
  expect((await api.post('/api/v1/auth/refresh',{data:{refreshToken:session.refreshToken}})).status()).toBe(401)
  expect((await api.put('/api/v1/users/'+userId,{headers:headers(),data:{isActive:false}})).status()).toBe(409)
  expect((await api.delete('/api/v1/users/'+userId,{headers:headers()})).status()).toBe(409)
 })
 test('desktop browser supports sign in, editing, attendance, noticeboard, and reload',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await page.setViewportSize({width:1440,height:1050})
  await page.goto('/login');await page.getByLabel('Username',{exact:true}).fill('qa.admin')
  await page.getByLabel('Password',{exact:true}).fill(password)
  await page.getByText('Signing in to another school?').click();await page.getByLabel('School ID',{exact:true}).fill(schoolId)
  await page.getByRole('button',{name:'Sign in to workspace'}).click()
  await expect(page.getByRole('heading',{name:/Good .*QA/})).toBeVisible()
  await expect(page.getByText('Total students',{exact:true})).toBeVisible()
  mkdirSync(path.join(root,'.local/screenshots'),{recursive:true})
  await page.screenshot({path:path.join(root,'.local/screenshots/dashboard-desktop.png'),fullPage:true})
  await page.getByRole('link',{name:'Student records',exact:true}).click()
  await page.getByRole('button',{name:'Edit Aarav TestStudent'}).click()
  await expect(page.getByLabel('Date of birth')).toHaveValue('2014-03-12')
  await page.getByLabel('First name',{exact:true}).fill('Aarav Updated')
  await page.getByRole('button',{name:'Save student'}).click();await expect(page.getByText('student saved successfully.')).toBeVisible()
  await page.reload();await expect(page.getByText('Aarav Updated TestStudent',{exact:true})).toBeVisible()
  await page.goto('/attendance')
  await page.getByLabel('Attendance for Aarav Updated TestStudent').selectOption('Present')
  await page.getByRole('button',{name:'Save attendance'}).click();await expect(page.getByText('Attendance saved successfully.')).toBeVisible()
  await page.getByRole('link',{name:'Admin noticeboard',exact:true}).click();await expect(page.getByRole('heading',{name:'Welcome to the new term'})).toBeVisible()
  await page.getByRole('link',{name:'School settings & accounts',exact:true}).click();await expect(page.getByLabel('School name')).toHaveValue('QA School')
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Good to see you.'})).toBeVisible()
  expect(errors).toEqual([])
 })
 test('mobile layout is usable without page overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844})
  await page.goto('/login');await page.getByLabel('Username',{exact:true}).fill('qa.admin');await page.getByLabel('Password',{exact:true}).fill(password)
  await page.getByText('Signing in to another school?').click();await page.getByLabel('School ID',{exact:true}).fill(schoolId)
  await page.getByRole('button',{name:'Sign in to workspace'}).click();await expect(page.getByRole('heading',{name:/Good .*QA/})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy()
  await page.screenshot({path:path.join(root,'.local/screenshots/dashboard-mobile.png'),fullPage:true})
  await page.getByRole('button',{name:'Open navigation'}).click();await page.getByRole('link',{name:'Student records',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Students',exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy()
 })
})
