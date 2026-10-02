import {test,expect,APIRequestContext,APIResponse} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import path from 'node:path'
import {clearIamSql} from './iam-fixtures'
const root=path.resolve(import.meta.dirname,'../..')
const env=Object.fromEntries(readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(x=>x&&!x.startsWith('#')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)]}))
const password=env.EDUOS_BOOTSTRAP_ADMIN_PASSWORD,demoPassword=process.env.EDUOS_DEMO_PASSWORD||'EduOS@Demo2026!!',tag=randomUUID().slice(0,8)
let api:APIRequestContext,platform:any,admin:any,other:any,teacher:any,school='',schoolB='',config:any,requestId='',teacherProfile='',approvedId='',customRole='',customUser='',customTemplate=randomUUID()
const applicant='iam-'+tag+'@example.test'
async function login(username:string,pw=password){for(let i=0;i<20;i++){const r=await api.post('/api/v1/auth/login',{data:{username,password:pw}});if(r.status()===429){await new Promise(f=>setTimeout(f,6500));continue}expect(r.status(),await r.text()).toBe(200);return(await r.json()).data}throw Error('Login throttled')}
const call=async(session:any,method:string,url:string,data?:unknown):Promise<APIResponse>=>{for(let i=0;;i++){const r=await api.fetch('/api/v1'+url,{method,headers:session?{Authorization:'Bearer '+session.accessToken}:{},...(data===undefined?{}:{data})});if(r.status()!==429||i>=15)return r;await new Promise(f=>setTimeout(f,6500))}}
async function ok(session:any,method:string,url:string,data?:unknown,status=200){const r=await call(session,method,url,data);expect(r.status(),method+' '+url+' '+await r.text()).toBe(status);return(await r.json()).data}
async function denied(session:any,method:string,url:string,data?:unknown,status=403){const r=await call(session,method,url,data);expect(r.status(),await r.text()).toBe(status)}
const role=(name:string)=>config.roles.find((r:any)=>r.name===name)
const signup=(email:string,requestedRole='Teacher')=>({email,password,firstName:'IAM',lastName:'Applicant',phone:'9000000999',schoolCode:config.boundary.signupCode,requestedRole})
async function renewAdmin(){admin=await login('iam-admin-'+tag)}
const psql=(query:string)=>execFileSync('docker',['compose','exec','-T','postgres','psql','-U',env.POSTGRES_USER,'-d',env.POSTGRES_DB,'-v','ON_ERROR_STOP=1','-c',query],{cwd:root,stdio:'pipe'})
test.describe.serial('IAM lifecycle and security',()=>{
 test.beforeAll(async({playwright})=>{
  test.setTimeout(180000);api=await playwright.request.newContext({baseURL:process.env.EDUOS_TEST_URL||'http://localhost:8080'})
  platform=await login('superadmin@eduos.local',demoPassword)
  school=(await ok(platform,'POST','/platform/schools',{name:'IAM QA '+tag},201)).id
  schoolB=(await ok(platform,'POST','/platform/schools',{name:'IAM QA other '+tag},201)).id
  await ok(platform,'POST','/platform/schools/'+school+'/administrators',{username:'iam-admin-'+tag,email:'iam-admin-'+tag+'@example.test',firstName:'IAM',lastName:'Admin',password},201)
  await ok(platform,'POST','/platform/schools/'+schoolB+'/administrators',{username:'iam-other-'+tag,email:'iam-other-'+tag+'@example.test',firstName:'Other',lastName:'Admin',password},201)
  await renewAdmin();other=await login('iam-other-'+tag)
  config=await ok(admin,'GET','/control/configuration')
  teacherProfile=(await ok(admin,'POST','/teachers',{employeeCode:'IAM-'+tag,firstName:'IAM',lastName:'Teacher',email:'iam-profile-'+tag+'@example.test',department:'Science'},201)).id
 })
 test.afterAll(async()=>{
  for(const id of [school,schoolB].filter(Boolean)){
   const tables=['suite.documents','suite.acknowledgements','suite.payments','suite.charges','suite.student_classes','suite.records','suite.counters','school_db.attendance','student_db.students','teacher_db.teachers','parent_db.parents','school_db.announcements','auth_db.password_resets','auth_db.refresh_tokens','auth_db.users']
   const query='BEGIN; '+clearIamSql(id)+tables.map(t=>`DELETE FROM ${t} WHERE school_id='${id}';`).join(' ')+`DELETE FROM auth_db.role_permissions WHERE role_id IN(SELECT id FROM auth_db.roles WHERE school_id='${id}');DELETE FROM auth_db.roles WHERE school_id='${id}';DELETE FROM school_db.schools WHERE id='${id}';DELETE FROM school_db.audit_logs WHERE school_id='${id}';DELETE FROM suite.audit WHERE school_id='${id}';COMMIT;`
   psql(query)
  }
  await api?.dispose()
 })
 test('signup stays pending and cannot choose platform access',async()=>{
  await denied(null,'POST','/auth/signup',signup(applicant,'SuperAdmin'),400)
  await denied(null,'POST','/auth/signup',{...signup(applicant),schoolCode:'unknown'},400)
  await ok(null,'POST','/auth/signup',{...signup(applicant),roleId:role('Administrator').id,permissions:['platform.manage']},201)
  const pending=await call(null,'POST','/auth/login',{username:applicant,password});expect(pending.status()).toBe(403);expect(await pending.text()).toContain('awaiting school administrator approval')
  const requests=await ok(admin,'GET','/control/signup-requests');requestId=requests.find((r:any)=>r.email===applicant).id
 })
 test('cross-school approval and arbitrary profile substitution fail',async()=>{
  await denied(other,'POST','/control/signup-requests/'+requestId+'/review',{approve:true,roleId:role('Teacher').id,teacherId:teacherProfile},404)
  await denied(other,'GET','/control/configuration?targetSchool='+school)
  await denied(admin,'POST','/control/signup-requests/'+requestId+'/review',{approve:true,roleId:role('Teacher').id,teacherId:randomUUID()},400)
 })
 test('approval assigns authoritative Teacher role and verified profile',async()=>{
  await ok(admin,'POST','/control/signup-requests/'+requestId+'/review',{approve:true,roleId:role('Teacher').id,teacherId:teacherProfile})
  teacher=await login(applicant);approvedId=teacher.user.id
  expect(teacher.user.roles).toEqual(['Teacher']);expect(teacher.user.permissions).toContain('homework.manage');expect(teacher.user.permissions).not.toContain('roles.assign')
  await denied(teacher,'PUT','/control/users/'+approvedId,{roleId:role('Principal').id,isActive:true})
  await denied(admin,'POST','/control/signup-requests/'+requestId+'/review',{approve:true,roleId:role('Teacher').id,teacherId:teacherProfile},409)
 })
 test('Teacher to Principal and back revokes access and refresh tokens',async()=>{
  test.setTimeout(90000)
  const stale=teacher
  await ok(admin,'PUT','/control/users/'+approvedId,{roleId:role('Principal').id,isActive:true})
  await denied(stale,'GET','/suite/catalog',undefined,401)
  const direct=execFileSync('docker',['compose','exec','-T','school-service','curl','-s','-o','/dev/null','-w','%{http_code}','--config','-'],{cwd:root,encoding:'utf8',input:'url = "http://localhost:6005/api/suite/catalog"\nheader = "Authorization: Bearer '+stale.accessToken+'"\n',stdio:['pipe','pipe','pipe']})
  expect(direct).toBe('401')
  await denied(null,'POST','/auth/refresh',{refreshToken:stale.refreshToken},401)
  teacher=await login(applicant);expect(teacher.user.roles).toEqual(['Principal']);expect(teacher.user.permissions).toContain('overview.view')
  await ok(admin,'PUT','/control/users/'+approvedId,{roleId:role('Teacher').id,isActive:true})
  await denied(teacher,'GET','/operations/overview?day=2026-10-01',undefined,401)
  teacher=await login(applicant);expect(teacher.user.permissions).not.toContain('overview.view')
 })
 test('school administrators cannot bypass platform role or permission boundaries',async()=>{
  await denied(admin,'PUT','/control/users/'+approvedId,{roleId:role('Administrator').id,isActive:true})
  await denied(admin,'POST','/control/roles',{name:'SuperAdmin',description:'',templateId:role('Teacher').templateId,enabled:true,assignable:true,permissions:[]})
  await denied(admin,'POST','/control/roles',{name:'Escalated',description:'',templateId:role('Teacher').templateId,enabled:true,assignable:true,permissions:['fees.manage']})
  await denied(admin,'PUT','/control/templates/'+customTemplate,{name:'Escalated',dataScope:'platform',maximum:['platform.manage'],defaults:[]})
  await denied(admin,'PUT','/users/'+approvedId,{roleId:role('Administrator').id})
 })
 test('permission removal revokes sessions and changes the next JWT',async()=>{
  test.setTimeout(90000);const r=role('Teacher');const stale=teacher
  await ok(admin,'PUT','/control/roles/'+r.id,{...r,permissions:r.permissions.filter((p:string)=>p!=='homework.manage')})
  await denied(stale,'GET','/suite/catalog',undefined,401)
  await renewAdmin();teacher=await login(applicant)
  expect(teacher.user.permissions).not.toContain('homework.manage');await denied(teacher,'POST','/suite/records/homework',{})
 })
 test('a permission added to an existing role is saved and reaches the next JWT',async()=>{
  test.setTimeout(90000);const r=role('Teacher')
  // The previous test took homework.manage away from this role. Saving the role with it again must store the grant.
  expect(r.permissions).toContain('homework.manage')
  await ok(admin,'PUT','/control/roles/'+r.id,{...r,permissions:r.permissions})
  await renewAdmin();const saved=(await ok(admin,'GET','/control/configuration')).roles.find((x:any)=>x.id===r.id)
  expect(saved.permissions).toContain('homework.manage');expect([...saved.permissions].sort()).toEqual([...r.permissions].sort())
  teacher=await login(applicant);expect(teacher.user.permissions).toContain('homework.manage')
  // Saving it once more changes nothing and adds no duplicate.
  await ok(admin,'PUT','/control/roles/'+r.id,{...r,permissions:r.permissions})
  await renewAdmin();expect((await ok(admin,'GET','/control/configuration')).roles.find((x:any)=>x.id===r.id).permissions.length).toBe(r.permissions.length)
  teacher=await login(applicant)
 })
 test('custom Accountant template and role work without authentication changes',async()=>{
  test.setTimeout(90000)
  await ok(platform,'PUT','/control/templates/'+customTemplate,{id:customTemplate,name:'Accountant '+tag,description:'Finance scope',dataScope:'school',enabled:true,assignable:true,maximum:['fees.view','fees.collect'],defaults:['fees.view']})
  platform=await login('superadmin@eduos.local',demoPassword);await renewAdmin()
  customRole=(await ok(admin,'POST','/control/roles',{name:'Accountant',description:'School finance',templateId:customTemplate,enabled:true,assignable:true,permissions:['fees.view','fees.collect']})).id
  await renewAdmin()
  customUser=(await ok(admin,'POST','/users',{roleId:customRole,username:'iam-accountant-'+tag,email:'iam-accountant-'+tag+'@example.test',firstName:'Finance',lastName:'User',password},201)).id
  const accountant=await login('iam-accountant-'+tag);expect(accountant.user.roles).toEqual(['Accountant']);expect(accountant.user.permissions.sort()).toEqual(['fees.collect','fees.view'])
  await ok(accountant,'GET','/suite/fees');await denied(accountant,'GET','/students')
 })
 test('platform maximum reduction cannot be restored by school admin',async()=>{
  test.setTimeout(90000)
  await ok(platform,'PUT','/control/templates/'+customTemplate,{id:customTemplate,name:'Accountant '+tag,description:'Finance scope',dataScope:'school',enabled:true,assignable:true,maximum:['fees.view'],defaults:['fees.view']})
  platform=await login('superadmin@eduos.local',demoPassword);await renewAdmin()
  await denied(admin,'PUT','/control/roles/'+customRole,{name:'Accountant',description:'',templateId:customTemplate,enabled:true,assignable:true,permissions:['fees.view','fees.collect']})
  const accountant=await login('iam-accountant-'+tag);expect(accountant.user.permissions).toEqual(['fees.view'])
 })
 test('disabled accounts cannot replay refresh tokens or regain access',async()=>{
  const accountant=await login('iam-accountant-'+tag)
  await ok(admin,'PUT','/control/users/'+customUser,{roleId:customRole,isActive:false})
  await denied(accountant,'GET','/suite/fees',undefined,401)
  await denied(null,'POST','/auth/refresh',{refreshToken:accountant.refreshToken},401)
  const blocked=await call(null,'POST','/auth/login',{username:'iam-accountant-'+tag,password});expect(blocked.status()).toBe(403);expect(await blocked.text()).toContain('currently disabled')
 })
 test('unreviewed requests expire and can no longer be approved',async()=>{
  const email='expired-'+tag+'@example.test';await ok(null,'POST','/auth/signup',signup(email,'Student'),201)
  const id=(await ok(admin,'GET','/control/signup-requests')).find((r:any)=>r.email===email).id
  psql(`UPDATE auth_db.signup_requests SET created_at=now()-interval '31 days' WHERE id='${id}';`)
  expect((await ok(admin,'GET','/control/signup-requests')).find((r:any)=>r.id===id).status).toBe('Expired')
  await denied(admin,'POST','/control/signup-requests/'+id+'/review',{approve:true,roleId:role('Teacher').id,teacherId:teacherProfile},409)
  const result=await call(null,'POST','/auth/login',{username:email,password});expect(result.status()).toBe(401)
  expect((await ok(admin,'GET','/control/access-history')).some((a:any)=>a.action==='signup.expired'&&a.target_id===id)).toBe(true)
 })
 test('rejection records a decision and grants no access',async()=>{
  const email='rejected-'+tag+'@example.test';await ok(null,'POST','/auth/signup',signup(email,'Parent'),201)
  const requests=await ok(admin,'GET','/control/signup-requests');const id=requests.find((r:any)=>r.email===email).id
  await ok(admin,'POST','/control/signup-requests/'+id+'/review',{approve:false,reason:'Unable to verify relationship'})
  const result=await call(null,'POST','/auth/login',{username:email,password});expect(result.status()).toBe(403);expect(await result.text()).toContain('not approved')
  const audit=await ok(admin,'GET','/control/access-history');expect(audit.map((a:any)=>a.action)).toEqual(expect.arrayContaining(['signup.approved','signup.rejected','user.access.changed','role.created','role.changed']))
 })
 test('school and platform control panels work on desktop and mobile',async({page})=>{
  await page.addInitScript(s=>{localStorage.setItem('accessToken',s.accessToken);localStorage.setItem('refreshToken',s.refreshToken);localStorage.setItem('user',JSON.stringify(s.user))},admin)
  await page.goto('/control/users');await expect(page.getByRole('heading',{name:'Access control',exact:true})).toBeVisible();await expect(page.getByRole('row',{name:new RegExp(applicant)})).toBeVisible()
  await page.setViewportSize({width:390,height:844});await page.goto('/control/roles');await expect(page.getByRole('button',{name:'Create role',exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true)
 })
 test('approved signup lands in the Teacher portal with permission-driven navigation',async({page})=>{
  teacher=await login(applicant)
  await page.addInitScript(s=>{localStorage.setItem('accessToken',s.accessToken);localStorage.setItem('refreshToken',s.refreshToken);localStorage.setItem('user',JSON.stringify(s.user))},teacher)
  await page.goto('/');await expect(page).toHaveURL(/\/teacher$/)
  await expect(page.getByRole('link',{name:'Access control'})).toHaveCount(0)
  await page.goto('/control/users');await expect(page.getByRole('heading',{name:/isn.t available for your role/})).toBeVisible()
 })
})
