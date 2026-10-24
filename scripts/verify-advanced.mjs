import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
const base=process.env.EDUOS_TEST_URL||'http://localhost:8081',password=process.env.EDUOS_PLATFORM_TEST_PASSWORD
if(!password)throw Error('Set EDUOS_PLATFORM_TEST_PASSWORD to the local platform administrator password.')
const stamp=Date.now(),name='QA Advanced Operations '+stamp,secret=randomBytes(24).toString('base64url')+'!aA1'
let checks=0,school,platform,admin
async function call(method,path,token,body,status=200){const r=await fetch(base+'/api/v1'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const json=await r.json().catch(()=>({}));assert.equal(r.status,status,method+' '+path+': '+JSON.stringify(json));checks++;return json.data}
async function record(kind,body,status=201){return call('POST','/suite/records/'+kind,admin,body,status)}
async function get(kind,id){const list=await call('GET','/suite/records/'+kind,admin);return list.data.find(r=>r.id===id)}
async function update(kind,id,changes,status=200){const r=await get(kind,id);return call('PUT','/suite/records/'+kind+'/'+id,admin,{...r,...changes},status)}
try{
 await call('GET','/suite/analytics/operations',null,null,401)
 platform=(await call('POST','/auth/login',null,{username:process.env.EDUOS_PLATFORM_TEST_USERNAME||'superadmin@eduos.local',password})).accessToken
 school=(await call('POST','/platform/schools',platform,{name,subscriptionTier:'trial'},201)).id
 const username='qa.advanced.'+stamp+'@example.test'
 await call('POST','/platform/schools/'+school+'/administrators',platform,{username,email:username,firstName:'QA',lastName:'Operations',password:secret},201)
 const session=await call('POST','/auth/login',null,{username,password:secret});admin=session.accessToken
 const catalog=await call('GET','/suite/catalog',admin)
 for(const kind of ['library-books','library-loans','inventory-items','inventory-assignments','transport-routes','transport-stops','transport-assignments'])assert(catalog.some(m=>m.kind===kind&&m.canWrite),'Missing writable module '+kind)
 const student=async(n)=>(await call('POST','/students',admin,{schoolId:school,rollNumber:'QA-'+n,firstName:'Student',lastName:n,email:n+'@example.test',currentClass:'QA',dateOfBirth:'2015-01-01'},201)).id
 const s1=await student('One'),s2=await student('Two')
 const teacher=(await call('POST','/teachers',admin,{schoolId:school,employeeCode:'QA-T'+stamp,firstName:'QA',lastName:'Teacher',email:'qa.teacher.'+stamp+'@example.test',department:'QA'},201)).id
 const date=new Date().toISOString().slice(0,10)
 await record('library-books',{title:'Invalid stock',code:'BAD',author:'QA',copies:1.5,status:'Available'},400)
 const book=(await record('library-books',{title:'QA Book',code:'B1',author:'QA',copies:1,status:'Available'})).id
 const loan={bookId:book,studentId:s1,issuedOn:date,dueOn:date,status:'Issued'}
 const lend=async(studentId)=>{const r=await fetch(base+'/api/v1/suite/records/library-loans',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+admin},body:JSON.stringify({...loan,studentId})});return {status:r.status,body:await r.json()}}
 const race=await Promise.all([lend(s1),lend(s2)]);assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);checks++
 const issued=race.find(r=>r.status===201).body.data.id
 await update('library-books',book,{status:'Retired'},409)
 await update('library-loans',issued,{status:'Returned',returnedOn:date})
 await update('library-loans',issued,{status:'Issued',returnedOn:''},409)
 await record('library-loans',{...loan,dueOn:'2000-01-01'},400)
 const item=(await record('inventory-items',{name:'QA Laptop',code:'A1',category:'IT',quantity:2,location:'QA store',status:'Active'})).id
 const asset=(await record('inventory-assignments',{itemId:item,teacherId:teacher,quantity:2,issuedOn:date,status:'Assigned'})).id
 await record('inventory-assignments',{itemId:item,teacherId:teacher,quantity:1,issuedOn:date,status:'Assigned'},409)
 await update('inventory-items',item,{quantity:1},409)
 await update('inventory-assignments',asset,{status:'Returned',returnedOn:date})
 const route=(await record('transport-routes',{name:'QA Route',vehicle:'QA-01',driver:'QA Driver',phone:'9000000000',capacity:1,status:'Active'})).id
 const stop=(await record('transport-stops',{name:'QA Stop',routeId:route,sequence:1,pickup:'07:30',dropoff:'16:00'})).id
 await record('transport-stops',{name:'Duplicate order',routeId:route,sequence:'1.0',pickup:'08:00',dropoff:'16:30'},409)
 const otherRoute=(await record('transport-routes',{name:'QA Other',vehicle:'QA-02',driver:'QA Driver',phone:'9000000000',capacity:1,status:'Active'})).id
 await record('transport-assignments',{studentId:s1,routeId:otherRoute,stopId:stop,status:'Active'},400)
 const assignment=(await record('transport-assignments',{studentId:s1,routeId:route,stopId:stop,status:'Active'})).id
 await record('transport-assignments',{studentId:s2,routeId:route,stopId:stop,status:'Active'},409)
 await update('transport-routes',route,{status:'Inactive'},409)
 await update('transport-stops',stop,{routeId:otherRoute},409)
 await update('transport-assignments',assignment,{status:'Inactive'})
 await record('transport-assignments',{studentId:s2,routeId:route,stopId:stop,status:'Active'})
 const stats=await call('GET','/suite/analytics/operations',admin);assert.equal(stats.library.issued,0);assert.equal(stats.inventory.assigned,0);assert.equal(stats.transport.passengers,1)
 // A second school's administrator cannot use the first school's stock or read its records.
 const school2=(await call('POST','/platform/schools',platform,{name:name+' isolation',subscriptionTier:'trial'},201)).id
 try{
  const username2='isolation.'+stamp+'@example.test'
  await call('POST','/platform/schools/'+school2+'/administrators',platform,{username:username2,email:username2,firstName:'QA',lastName:'Isolation',password:secret},201)
  const token2=(await call('POST','/auth/login',null,{username:username2,password:secret})).accessToken
  assert.equal((await call('GET','/suite/records/library-books',token2)).totalCount,0)
  await call('POST','/suite/records/library-loans',token2,loan,404)
 }finally{await call('PUT','/platform/schools/'+school2,platform,{isActive:false})}
 // Scoped school accounts cannot enter office modules or whole-school analytics.
 const roles=await call('GET','/roles',admin)
 const teacherRole=roles.find(r=>r.name==='Teacher')
 const teacherName='qa.scoped.'+stamp+'@example.test'
 await call('POST','/users',admin,{schoolId:school,roleId:teacherRole.id,username:teacherName,email:teacherName,firstName:'Scoped',lastName:'Teacher',password:secret},201)
 const scoped=(await call('POST','/auth/login',null,{username:teacherName,password:secret})).accessToken
 await call('GET','/suite/records/library-books',scoped,null,403)
 await call('GET','/suite/analytics/operations',scoped,null,403)
 console.log(JSON.stringify({passed:true,checks,school:name,coverage:['stock race','loan returns','inventory capacity','transport capacity','route-stop matching','school isolation','role permissions','analytics']}))
}finally{
 if(school&&platform)await call('PUT','/platform/schools/'+school,platform,{isActive:false})
}
