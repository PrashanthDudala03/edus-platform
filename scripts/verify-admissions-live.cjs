const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),{randomUUID}=require('node:crypto');const base='http://localhost:8081/api/v1';
async function call(path,token,body,method=body?'POST':'GET',expected=200){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();assert.equal(r.status,expected,path+': '+text.slice(0,300));return text?JSON.parse(text).data:null;}
const sql=q=>execFileSync('docker',['exec','-i','eduos-postgres-1','sh','-c','exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At'],{input:q,encoding:'utf8'}).trim();
(async()=>{
const login=async name=>call('/auth/login',null,{username:name+'@demo.eduos.local',password:process.env.EDUOS_DEMO_TEST_PASSWORD});const [admin,teacher,parent]=await Promise.all(['admin','teacher','parent'].map(login));const a=admin.accessToken,school=admin.user.schoolId;assert.match(school,/^[a-f0-9-]{36}$/i);
const options=await call('/suite/options',a),tag=randomUUID().slice(0,8);let id;
const payload={classId:options.classes[0].id,firstName:'QA'+tag,lastName:'Admission',dateOfBirth:'2014-03-12',email:tag+'@example.test',phoneNumber:'9000000000',guardianName:'QA Guardian',guardianEmail:'guardian-'+tag+'@example.test',guardianPhone:'9000000001',gender:'Other',address:'Temporary audit',status:'Draft'};
try{
await call('/suite/records/admissions',a,{...payload,dateOfBirth:'2099-01-01'},'POST',400);
const created=await call('/suite/records/admissions',a,payload,'POST',201);id=created.id;assert.match(id,/^[a-f0-9-]{36}$/i);
const read=async()=>(await call('/suite/records/admissions?search='+tag,a)).data.find(r=>r.id===id);const draft=await read();assert.equal(draft.status,'Draft');
await call('/suite/records/admissions/'+id,a,{...payload,lastName:'Updated',version:draft.version},'PUT');const edited=await read();assert.equal(edited.lastName,'Updated');
await call('/suite/admissions/'+id+'/transition',teacher.accessToken,{to:'Approved'},'POST',403);await call('/suite/admissions/'+id,parent.accessToken,undefined,'GET',403);
await call('/suite/admissions/'+id+'/transition',a,{to:'Withdrawn',reason:'Temporary audit cleanup',version:edited.version});assert.equal((await read()).status,'Withdrawn');
console.log('Live API passed: future DOB rejected, draft create/edit/reload, teacher approval denied, parent detail denied, withdrawal persisted.');
}finally{if(id){sql(`DELETE FROM suite.records WHERE school_id='${school}' AND id='${id}' AND kind='admissions';`);assert.equal(sql(`SELECT count(*) FROM suite.records WHERE school_id='${school}' AND id='${id}';`),'0');console.log('Temporary application removed; audit retained. No onboarding, account activation or invitations.');}}
})().catch(e=>{console.error(e.message);process.exitCode=1});
