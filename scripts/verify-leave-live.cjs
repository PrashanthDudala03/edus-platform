const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');const base='http://localhost:8081/api/v1';
async function call(path,token,body,expected=200){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();assert.equal(r.status,expected,path+': '+text.slice(0,250));return text?JSON.parse(text).data:null;}
(async()=>{
const login=async name=>call('/auth/login',null,{username:name+'@demo.eduos.local',password:process.env.EDUOS_DEMO_TEST_PASSWORD});const [teacher,parent]=await Promise.all(['teacher','parent'].map(login));const t=teacher.accessToken;
const balances=await call('/suite/leave/balances',t);assert(balances.teacherId);assert(Array.isArray(balances.balances));
await call('/suite/leave/balances?teacherId='+randomUUID(),t,undefined,403);
await call('/suite/leave/queue',t,undefined,403);await call('/suite/leave/balances',parent.accessToken,undefined,403);
const types=await call('/suite/records/leave-types',t),type=types.data.find(x=>x.active==='Yes');assert(type);
const before=await call('/suite/records/leave-requests',t);
const draft={teacherId:balances.teacherId,typeId:type.id,fromDate:'2026-11-03',toDate:'2026-11-02',halfDay:'First half',reason:'Validation-only audit',status:'Pending'};
await call('/suite/records/leave-requests',t,draft,400);
await call('/suite/records/leave-requests',t,{...draft,toDate:'2026-11-03',status:'Approved'},403);
const after=await call('/suite/records/leave-requests',t);assert.deepEqual(after,before);
console.log('Live API passed: own balances, other-profile denial, leadership queue denial, parent denial, invalid dates and teacher self-approval rejected; request records unchanged.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
