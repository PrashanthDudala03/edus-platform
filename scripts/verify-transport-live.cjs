const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process');const base='http://localhost:8081/api/v1';
async function call(path,t,body,method=body?'POST':'GET',expected=200){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();assert.equal(r.status,expected,path+': '+text.slice(0,250));return text?JSON.parse(text).data:null;}
const sql=q=>execFileSync('docker',['exec','-i','eduos-postgres-1','sh','-c','exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At'],{input:q,encoding:'utf8'}).trim();
(async()=>{const login=async name=>call('/auth/login',null,{username:name+'@demo.eduos.local',password:process.env.EDUOS_DEMO_TEST_PASSWORD});const [admin,teacher]=await Promise.all(['admin','teacher'].map(login)),t=admin.accessToken,school=admin.user.schoolId;assert.match(school,/^[a-f0-9-]{36}$/i);const opts=await call('/suite/options',t),tag=randomUUID().slice(0,8),routes=[],pupils=[];
const read=async(kind,id)=>(await call('/suite/records/'+kind,t)).data.find(r=>r.id===id);
try{
for(let i=0;i<2;i++){const s=await call('/students',t,{schoolId:school,firstName:'QA'+tag,lastName:'Rider'+i,email:tag+i+'@example.test',dateOfBirth:'2014-03-12T00:00:00Z',rollNumber:'QA-'+tag+'-'+i,currentClass:'QA transport'},'POST',201);assert.match(s.id,/^[a-f0-9-]{36}$/i);pupils.push(s.id);}
const payload={name:'QA route '+tag,vehicle:'QA-'+tag,driver:'QA Driver',phone:'9000000000',capacity:1,status:'Active'};
await call('/suite/records/transport-routes',t,{...payload,capacity:0},'POST',400);
for(let i=0;i<2;i++){const r=await call('/suite/records/transport-routes',t,{...payload,name:payload.name+' '+i},'POST',201);assert.match(r.id,/^[a-f0-9-]{36}$/i);routes.push(r.id);}
const stopPayload={name:'QA stop '+tag,routeId:routes[0],sequence:1,pickup:'07:30',dropoff:'16:00'},stop=(await call('/suite/records/transport-stops',t,stopPayload,'POST',201)).id;
await call('/suite/records/transport-stops',t,{...stopPayload,name:'Duplicate order '+tag},'POST',409);
const assignment={studentId:pupils[0],routeId:routes[0],stopId:stop,status:'Active'};
await call('/suite/records/transport-assignments',t,{...assignment,routeId:routes[1]},'POST',400);
const issue=(await call('/suite/records/transport-assignments',t,assignment,'POST',201)).id;let row=await read('transport-assignments',issue);assert.equal(row.studentId,pupils[0]);
await call('/suite/records/transport-assignments',t,assignment,'POST',409);
await call('/suite/records/transport-assignments',t,{...assignment,studentId:pupils[1]},'POST',409);
const route=await read('transport-routes',routes[0]);await call('/suite/records/transport-routes/'+routes[0],t,{...route,status:'Inactive'},'PUT',409);
const stopRow=await read('transport-stops',stop);await call('/suite/records/transport-stops/'+stop,t,{...stopRow,routeId:routes[1]},'PUT',409);
await call('/suite/records/transport-assignments',teacher.accessToken,{...assignment,studentId:pupils[1]},'POST',403);
await call('/suite/records/transport-assignments/'+issue,t,{...row,status:'Inactive'},'PUT');row=await read('transport-assignments',issue);assert.equal(row.status,'Inactive');
await call('/suite/records/transport-assignments',t,{...assignment,studentId:pupils[1]},'POST',201);
console.log('Transport passed: capacity validation, stop order uniqueness, route/stop matching, assignment/reload, duplicates/full bus blocked, route/stop protection, deactivation/reload, freed-seat reuse and teacher write denial.');
}finally{const rs=routes.map(x=>"'"+x+"'").join(','),ps=pupils.map(x=>"'"+x+"'").join(',');sql('BEGIN;'+(rs?`DELETE FROM suite.records WHERE school_id='${school}' AND kind IN('transport-assignments','transport-stops') AND data->>'routeId' IN(${rs});DELETE FROM suite.records WHERE school_id='${school}' AND kind='transport-routes' AND id IN(${rs});`:'')+(ps?`DELETE FROM student_db.students WHERE school_id='${school}' AND id IN(${ps});`:'')+'COMMIT;');console.log('Temporary routes, stops, passengers and pupils removed; audit retained.');}
})().catch(e=>{console.error(e.message);process.exitCode=1});
