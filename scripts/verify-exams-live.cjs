const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const base='http://localhost:8081/api/v1';
async function call(path,token,body,method=body?'POST':'GET',expected=200){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();assert.equal(r.status,expected,path+': '+JSON.stringify(j));return j.data;}
const sql=q=>execFileSync('docker',['exec','-i','eduos-postgres-1','sh','-c','exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At'],{input:q,encoding:'utf8'}).trim();
(async()=>{
const login=async username=>call('/auth/login',null,{username,password:process.env.EDUOS_DEMO_TEST_PASSWORD});
const [admin,teacher,parent]=await Promise.all(['admin','teacher','parent'].map(x=>login(x+'@demo.eduos.local')));const a=admin.accessToken,t=teacher.accessToken,school=admin.user.schoolId;assert.match(school,/^[a-f0-9-]{36}$/i);
const assigns=await call('/suite/records/teaching-assignments',t);assert(assigns.data.length);const assigned=assigns.data[0];let id;
try{
const e=await call('/suite/records/exams',a,{name:'QA exam '+randomUUID(),classId:assigned.classId,subjectId:assigned.subjectId,maxMarks:'20',passMarks:'8',date:'2099-02-02',status:'Draft'},'POST',201);id=e.id;assert.match(id,/^[a-f0-9-]{36}$/i);
const path='/suite/exams/'+id,sheet=await call(path+'/marksheet',t);assert(sheet.canEdit);assert(sheet.students.length);const studentId=sheet.students[0].studentId;
let result=await call(path+'/marksheet',t,{entries:[{studentId,score:21,status:'Present'}]});assert.equal(result.saved,0);assert(result.errors.length);
result=await call(path+'/marksheet',t,{entries:[{studentId,score:17,status:'Present'}]});assert.equal(result.saved,1);assert.equal(result.errors.length,0);
const reload=await call(path+'/marksheet',t);assert.equal(Number(reload.students.find(s=>s.studentId===studentId).mark.score),17);
for(const to of ['Approved','Published'])await call(path+'/transition',t,{to},'POST',409);
const family=await call('/suite/exams/timetable',parent.accessToken);assert(!JSON.stringify(family).includes(id));
await call(path+'/marksheet',parent.accessToken,undefined,'GET',403);
console.log('Live API passed: draft creation, over-limit marks rejection, teacher save/reload, approval/publication denied, draft hidden from parent, parent marksheet denied.');
}finally{if(id){sql(`BEGIN;DELETE FROM suite.records WHERE school_id='${school}' AND kind='marks' AND data->>'examId'='${id}';DELETE FROM suite.records WHERE school_id='${school}' AND kind='exams' AND id='${id}';COMMIT;`);assert.equal(sql(`SELECT count(*) FROM suite.records WHERE school_id='${school}' AND (id='${id}' OR data->>'examId'='${id}');`),'0');console.log('Temporary exam and marks removed; audit retained.');}}
})().catch(e=>{console.error(e.message);process.exitCode=1});
