import {test,expect,APIRequestContext} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import path from 'node:path'
import {seedIamSql,clearIamSql} from './iam-fixtures'

const root=path.resolve(import.meta.dirname,'../..')
const env=Object.fromEntries(readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}))
const school=randomUUID(),other=randomUUID(),adminId=randomUUID(),parentId=randomUUID(),guardian=randomUUID(),foreignGuardian=randomUUID(),matching=randomUUID(),mismatch=randomUUID(),foreignStudent=randomUUID(),link=randomUUID(),requestId=randomUUID(),foreignRequest=randomUUID()
const tag=school.slice(0,8),email=`parent-${tag}@example.test`,password=env.EDUOS_BOOTSTRAP_ADMIN_PASSWORD
const sql=(query:string)=>execFileSync('docker',['compose','exec','-T','postgres','psql','-U',env.POSTGRES_USER,'-d',env.POSTGRES_DB,'-v','ON_ERROR_STOP=1','-c',query],{cwd:root,stdio:'pipe'})
let api:APIRequestContext,admin:any,parent:any
async function login(username:string){for(let i=0;i<20;i++){const r=await api.post('/api/v1/auth/login',{data:{username,password}});if(r.status()===429){await new Promise(f=>setTimeout(f,6500));continue}expect(r.status()).toBe(200);return(await r.json()).data}throw Error('Login throttled')}
const get=(url:string,session=admin)=>api.get('/api/v1'+url,{headers:{Authorization:'Bearer '+session.accessToken}})
async function data(url:string,session=admin){const r=await get(url,session);expect(r.status(),await r.text()).toBe(200);return(await r.json()).data}

test.describe.serial('Guardian review hints',()=>{
 test.beforeAll(async({playwright})=>{
  test.setTimeout(180000)
  sql(`BEGIN;
   INSERT INTO school_db.schools(id,name) VALUES('${school}','Guardian QA ${tag}'),('${other}','Guardian other ${tag}');
   INSERT INTO auth_db.roles(id,school_id,name) VALUES(gen_random_uuid(),'${school}','Administrator'),(gen_random_uuid(),'${school}','Parent');
   ${seedIamSql(school)}
   INSERT INTO auth_db.users(id,school_id,username,email,password_hash,first_name,last_name,role_id)
   SELECT v.id::uuid,'${school}',v.username,v.email,u.password_hash,'Guardian',v.role,r.id
   FROM auth_db.users u CROSS JOIN (VALUES('${adminId}','guardian-admin-${tag}','admin-${tag}@example.test','Administrator'),('${parentId}','guardian-parent-${tag}','${email}','Parent')) v(id,username,email,role)
   JOIN auth_db.roles r ON r.school_id='${school}' AND r.name=v.role
   WHERE u.school_id='${env.EDUOS_BOOTSTRAP_SCHOOL_ID}' AND u.username='${env.EDUOS_BOOTSTRAP_ADMIN_USERNAME.replaceAll("'","''")}';
   INSERT INTO parent_db.parents(id,school_id,first_name,last_name,email,phone_number) VALUES('${guardian}','${school}','Directory','Guardian','${email}','${tag}01'),('${foreignGuardian}','${other}','Foreign','Guardian','foreign-${tag}@example.test','${tag}02');
   INSERT INTO student_db.students(id,school_id,roll_number,first_name,last_name,email,current_class,admission_date,date_of_birth,parent_guardian_id) VALUES
   ('${matching}','${school}','MATCH','Matching','Child','match-${tag}@example.test','Grade 1',CURRENT_DATE,'2018-01-01','${guardian}'),
   ('${mismatch}','${school}','NONE','Unlinked','Child','none-${tag}@example.test','Grade 1',CURRENT_DATE,'2018-01-01',NULL),
   ('${foreignStudent}','${school}','FOREIGN','Scoped','Child','scoped-${tag}@example.test','Grade 1',CURRENT_DATE,'2018-01-01','${foreignGuardian}');
   INSERT INTO suite.records(id,school_id,kind,data,created_by,updated_by) VALUES('${link}','${school}','account-links','{"userId":"${parentId}","studentId":"${mismatch}","relationship":"parent","teacherId":""}','${adminId}','${adminId}');
   INSERT INTO auth_db.signup_requests(id,school_id,email,first_name,last_name,phone,password_hash,requested_role)
   SELECT v.id::uuid,v.school::uuid,'${email}','Request','Guardian','123',u.password_hash,'Parent' FROM auth_db.users u
   CROSS JOIN (VALUES('${requestId}','${school}'),('${foreignRequest}','${other}')) v(id,school) WHERE u.id='${adminId}';
   COMMIT;`)
  api=await playwright.request.newContext({baseURL:process.env.EDUOS_TEST_URL||'http://localhost:8080'})
  admin=await login('guardian-admin-'+tag);parent=await login('guardian-parent-'+tag)
 })
 test.afterAll(async()=>{
  for(const id of [school,other])sql(`BEGIN;${clearIamSql(id)}DELETE FROM suite.records WHERE school_id='${id}';DELETE FROM student_db.students WHERE school_id='${id}';DELETE FROM auth_db.refresh_tokens WHERE school_id='${id}';DELETE FROM auth_db.users WHERE school_id='${id}';DELETE FROM auth_db.role_permissions WHERE role_id IN(SELECT id FROM auth_db.roles WHERE school_id='${id}');DELETE FROM auth_db.roles WHERE school_id='${id}';DELETE FROM parent_db.parents WHERE school_id='${id}';DELETE FROM school_db.schools WHERE id='${id}';DELETE FROM school_db.audit_logs WHERE school_id='${id}';DELETE FROM suite.audit WHERE school_id='${id}';COMMIT;`)
  await api?.dispose()
 })
 test('suggestions use the authoritative account and never expose another tenant guardian',async()=>{
  const hints=await data('/control/guardian-review?signupRequestId='+requestId)
  expect(hints[0].id).toBe(matching);expect(hints[0].status).toBe('Match')
  expect(hints.find((s:any)=>s.id===foreignStudent)).toMatchObject({status:'No active guardian',guardianEmail:null})
  expect((await get('/control/guardian-review?signupRequestId='+foreignRequest)).status()).toBe(404)
  expect((await get('/control/guardian-review?userId='+parentId+'&targetSchool='+other)).status()).toBe(403)
  expect((await get('/control/guardian-review?userId='+parentId,parent)).status()).toBe(403)
  expect((await get('/control/guardian-mismatches',parent)).status()).toBe(403)
 })
 test('mismatch checks reflect guardian changes without changing parent portal links',async()=>{
  const before=(await data('/suite/options',parent)).students
  expect(before.map((s:any)=>s.id)).toEqual([mismatch])
  expect((await data('/control/guardian-mismatches')).rows).toEqual(expect.arrayContaining([expect.objectContaining({linkId:link,status:'No active guardian'})]))
  sql(`UPDATE parent_db.parents SET email='changed-${tag}@example.test' WHERE id='${guardian}';`)
  expect((await data('/control/guardian-review?userId='+parentId)).find((s:any)=>s.id===matching).status).toBe('Mismatch')
  sql(`UPDATE parent_db.parents SET deleted_at=now() WHERE id='${guardian}';`)
  expect((await data('/control/guardian-review?userId='+parentId)).find((s:any)=>s.id===matching).status).toBe('No active guardian')
  expect((await data('/suite/options',parent)).students).toEqual(before)
  sql(`UPDATE parent_db.parents SET email='${email}',deleted_at=NULL WHERE id='${guardian}';`)
 })
 test('approval, link editor and mobile overview display guardian hints',async({page})=>{
  await page.addInitScript(s=>{localStorage.setItem('accessToken',s.accessToken);localStorage.setItem('refreshToken',s.refreshToken);localStorage.setItem('user',JSON.stringify(s.user))},admin)
  await page.goto('/control/signup-requests');await page.getByRole('button',{name:'Review request'}).click()
  const config=await data('/control/configuration');await page.getByLabel('Approved role').selectOption(config.roles.find((r:any)=>r.name==='Parent').id)
  await expect(page.getByRole('option',{name:'Matching Child — Suggested: guardian email matches'})).toHaveCount(1)
  await page.getByLabel('Verified student record').selectOption(matching);await expect(page.getByText('Guardian email matches',{exact:true})).toBeVisible()
  await page.goto('/suite/account-links');await page.getByRole('button',{name:'Edit record',exact:true}).click();await expect(page.getByText('Directory guardian check',{exact:true})).toBeVisible();await expect(page.getByText('No active guardian',{exact:true})).toBeVisible()
  await page.setViewportSize({width:390,height:844});await page.goto('/control');await expect(page.getByRole('heading',{name:'Parent links needing review'})).toBeVisible();await expect(page.getByRole('cell',{name:'Unlinked Child',exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
 })
})
