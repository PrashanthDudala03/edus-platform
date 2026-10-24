import assert from 'node:assert/strict'
const base='http://localhost:8081/api/v1',password=process.env.EDUOS_DEMO_TEST_PASSWORD
if(!password)throw Error('Set EDUOS_DEMO_TEST_PASSWORD.')
let checks=0
async function get(path,token,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,200,path);checks++;return(await r.json()).data}
const login=async username=>(await get('/auth/login',null,{username,password})).accessToken
const admin=await login('admin@demo.eduos.local'),timings=[]
async function ask(token,question,kind='live'){const start=performance.now(),r=await get('/ai/assistant/ask',token,{question});assert.equal(r.available,true,JSON.stringify(r));assert.equal(r.kind,kind,question+': '+JSON.stringify(r));timings.push({question,milliseconds:Math.round(performance.now()-start),kind:r.kind});return r.answer}
const staff=await get('/teachers',admin),directory=await ask(admin,'give me all the staff details')
for(const row of staff.data.slice(0,3))assert(directory.includes(row.firstName+' '+row.lastName))
assert(!directory.includes('@'))
const types=await get('/suite/records/leave-types',admin),leave=await ask(admin,'what are the leave types ?')
for(const row of types.data.slice(0,3))assert(leave.includes(row.name))
const adjustments=await get('/suite/records/leave-adjustments',admin),adjustment=await ask(admin,'Can i see the life balance attendance adjustments?')
if(!adjustments.totalCount)assert(adjustment.includes('no records are saved'))
await ask(admin,'show staff attendance')
await ask(admin,'show leave balances')
await ask(admin,'list academic years')
await ask(admin,'what is the amount collected?')
const parent=await login('parent@demo.eduos.local'),denied=await ask(parent,'give me all the staff details','assistant');assert(denied.includes("isn't available for your account"))
console.log(JSON.stringify({passed:true,checks,timings,notes:'Read-only checks; school records and permissions were not changed.'}))
