const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process');const base='http://localhost:8081/api/v1';
async function call(path,t,body,method=body?'POST':'GET',expected=200){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();assert.equal(r.status,expected,path+': '+text.slice(0,250));return text?JSON.parse(text).data:null;}
const sql=q=>execFileSync('docker',['exec','-i','eduos-postgres-1','sh','-c','exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At'],{input:q,encoding:'utf8'}).trim();
(async()=>{const login=async name=>call('/auth/login',null,{username:name+'@demo.eduos.local',password:process.env.EDUOS_DEMO_TEST_PASSWORD});const [admin,teacher]=await Promise.all(['admin','teacher'].map(login)),t=admin.accessToken,school=admin.user.schoolId;assert.match(school,/^[a-f0-9-]{36}$/i);const opts=await call('/suite/options',t);assert(opts.teachers.length);let item;const tag=randomUUID().slice(0,8),date='2026-10-23';
const payload={name:'QA asset '+tag,code:'QA-'+tag,category:'IT',quantity:2,location:'QA store',status:'Active'};
const read=async(kind,id)=>(await call('/suite/records/'+kind,t)).data.find(r=>r.id===id);
try{
await call('/suite/records/inventory-items',t,{...payload,quantity:0},'POST',400);
item=(await call('/suite/records/inventory-items',t,payload,'POST',201)).id;assert.match(item,/^[a-f0-9-]{36}$/i);
await call('/suite/records/inventory-items',t,payload,'POST',409);
const issue={itemId:item,teacherId:opts.teachers[0].id,quantity:2,issuedOn:date,status:'Assigned'};
await call('/suite/records/inventory-assignments',t,{...issue,quantity:1.5},'POST',400);
const created=await call('/suite/records/inventory-assignments',t,issue,'POST',201),id=created.id;let assigned=await read('inventory-assignments',id);assert.equal(Number(assigned.quantity),2);
await call('/suite/records/inventory-assignments',t,{...issue,quantity:1},'POST',409);
const stock=await read('inventory-items',item);await call('/suite/records/inventory-items/'+item,t,{...stock,quantity:1},'PUT',409);await call('/suite/records/inventory-items/'+item,t,{...stock,status:'Retired'},'PUT',409);
await call('/suite/records/inventory-assignments/'+id,t,{...assigned,quantity:1},'PUT',409);
await call('/suite/records/inventory-assignments/'+id,t,{...assigned,status:'Returned',returnedOn:'2000-01-01'},'PUT',400);
await call('/suite/records/inventory-assignments/'+id,t,{...assigned,status:'Returned',returnedOn:date},'PUT');assigned=await read('inventory-assignments',id);assert.equal(assigned.status,'Returned');
await call('/suite/records/inventory-assignments/'+id,t,{...assigned,status:'Assigned',returnedOn:''},'PUT',409);
await call('/suite/records/inventory-assignments',teacher.accessToken,issue,'POST',403);
await call('/suite/records/inventory-assignments',t,issue,'POST',201);
console.log('Inventory passed: stock/code validation, assignment/reload, capacity, stock/retirement protection, immutable issue quantity, return/reload, invalid return date, reopening blocked, reissue and teacher write denial.');
}finally{if(item){sql(`BEGIN;DELETE FROM suite.records WHERE school_id='${school}' AND kind='inventory-assignments' AND data->>'itemId'='${item}';DELETE FROM suite.records WHERE school_id='${school}' AND kind='inventory-items' AND id='${item}';COMMIT;`);assert.equal(sql(`SELECT count(*) FROM suite.records WHERE school_id='${school}' AND (id='${item}' OR data->>'itemId'='${item}');`),'0');console.log('Temporary asset and assignments removed; audit retained.');}}
})().catch(e=>{console.error(e.message);process.exitCode=1});
