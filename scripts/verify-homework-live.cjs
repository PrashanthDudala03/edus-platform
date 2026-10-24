const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const base='http://localhost:8081/api/v1';
async function call(path,token,body,method=body?'POST':'GET',expected=200){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();assert.equal(r.status,expected,path+': '+JSON.stringify(j));return j.data;}
const sql=q=>execFileSync('docker',['exec','-i','eduos-postgres-1','sh','-c','exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At'],{input:q,encoding:'utf8'}).trim();
(async()=>{
const s=await call('/auth/login',null,{username:'teacher@demo.eduos.local',password:process.env.EDUOS_DEMO_TEST_PASSWORD}),token=s.accessToken,school=s.user.schoolId;assert.match(school,/^[a-f0-9-]{36}$/i);
const options=await call('/suite/options',token),classes=await call('/suite/records/classes',token),cls=classes.data[0];assert(cls);
const roster=await call('/suite/student-attendance?day=2001-01-02',token),pupil=roster.find(x=>x.class===cls.name+' - '+cls.section)||roster[0];assert(pupil);
const title='QA homework '+randomUUID(),assignment={title,classId:cls.id,subjectId:options.subjects[0].id,instructions:'Temporary audit draft',dueDate:'2099-01-02',submissionMode:'Physical',maxMarks:'20',status:'Draft'};
let id;
try{
const created=await call('/suite/records/homework',token,assignment,'POST',201);id=created.id;assert.match(id,/^[a-f0-9-]{36}$/i);
const path='/suite/homework/'+id;
if(process.env.EXPECT_BUG){await call(path+'/verify/'+pupil.id,token,{outcome:'Completed'},'PUT',403);console.log('Confirmed: teacher cannot create notebook check-off (403).');return;}
await call('/suite/records/submissions',token,{homeworkId:id,studentId:pupil.id,response:'Forged student answer'},'POST',403);
await call(path+'/verify/'+pupil.id,token,{outcome:'Completed'},'PUT',201);
let view=await call(path+'/submissions',token),sub=view.students.find(x=>x.studentId===pupil.id).submission;assert.equal(sub.outcome,'Completed');
await call('/suite/records/submissions/'+sub.id,token,{homeworkId:id,studentId:pupil.id,response:'Changed student answer',version:sub.version},'PUT',403);
await call(path+'/verify/'+pupil.id,token,{outcome:'INVALID'},'PUT',400);
await call(path+'/review/'+pupil.id,token,{grade:'21',feedback:'',version:sub.version},'PUT',400);
// Clearing a notebook check exercises updates without sending a family review notification.
await call(path+'/verify/'+pupil.id,token,{outcome:'Excused',version:sub.version},'PUT');
view=await call(path+'/submissions',token);assert.equal(view.students.find(x=>x.studentId===pupil.id).submission.outcome,'Excused');
const other=roster.find(x=>x.id!==pupil.id);if(other){await call(path+'/review/'+other.id,token,{grade:'17',feedback:'Temporary audit review'},'PUT',201);view=await call(path+'/submissions',token);const review=view.students.find(x=>x.studentId===other.id).submission;assert.equal(String(review.grade),'17');assert.equal(review.feedback,'Temporary audit review');}
await call('/suite/records/submissions',token,{homeworkId:id,studentId:randomUUID(),response:''},'POST',400);
console.log('Live draft API: notebook check-off, reload, marks validation, review creation, update, forged answers rejected and unknown-student validation passed.');
}finally{if(id){sql(`BEGIN;DELETE FROM suite.records WHERE school_id='${school}' AND kind='submissions' AND data->>'homeworkId'='${id}';DELETE FROM suite.records WHERE school_id='${school}' AND kind='homework' AND id='${id}';COMMIT;`);assert.equal(sql(`SELECT count(*) FROM suite.records WHERE school_id='${school}' AND (id='${id}' OR data->>'homeworkId'='${id}');`),'0');console.log('Temporary draft and submissions removed; audit retained.');}}
})().catch(e=>{console.error(e.message);process.exitCode=1});
