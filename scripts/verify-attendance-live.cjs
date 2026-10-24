const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const base='http://localhost:8081/api/v1',day='2001-01-02';
const sql=q=>execFileSync('docker',['exec','-i','eduos-postgres-1','sh','-c','exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At'],{input:q,encoding:'utf8'}).trim();
async function call(path,token,body,expected=200){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();assert.equal(r.status,expected,path+': '+JSON.stringify(j));return j.data;}
(async()=>{
 const session=await call('/auth/login',null,{username:'teacher@demo.eduos.local',password:process.env.EDUOS_DEMO_TEST_PASSWORD});
 const token=session.accessToken,school=session.user.schoolId;assert.match(school,/^[a-f0-9-]{36}$/i);
 const where=`school_id='${school}' AND day='${day}'`;
 const tables=['attendance_history','attendance_registers','attendance'];
 const count=()=>tables.map(t=>Number(sql(`SELECT count(*) FROM school_db.${t} WHERE ${where};`)));
 assert.deepEqual(count(),[0,0,0],'Test date must be empty before running');
 let started=false;
 try{
 const rows=await call('/suite/student-attendance?day='+day,token);assert(rows.length>0);
 const cls=rows[0].class,pupils=rows.filter(x=>x.class===cls),entries=pupils.map(x=>({studentId:x.id,status:'Present'}));
 await call('/suite/student-attendance',token,{day,entries:[{studentId:rows[0].id,status:'Invalid'}]},400);
 await call('/suite/student-attendance',token,{day,entries:[{studentId:rows[0].id,status:'Absent',reason:'Other'}]},400);
 await call('/suite/student-attendance',token,{day,entries:[{studentId:'00000000-0000-4000-8000-000000000099',status:'Present'}]},403);
 assert.deepEqual(count(),[0,0,0],'Rejected requests must not write');
 started=true;await call('/suite/student-attendance',token,{day,entries,submit:true});
 const reload=await call('/suite/student-attendance?day='+day,token);assert(pupils.every(s=>reload.some(x=>x.id===s.id&&x.status==='Present')));
 const registers=await call('/suite/student-attendance/registers?day='+day,token);assert.equal(registers.classes.find(x=>x.className===cls).state,'Submitted');
 const repeated=await call('/suite/student-attendance',token,{day,entries,submit:true});assert.equal(repeated.changed,0);
 await call('/suite/student-attendance',token,{day,entries:[{studentId:rows[0].id,status:'Absent',reason:'Sick'}]},403);
 console.log('Live API passed: validation, unknown/out-of-scope student denial, submit, reload, repeated no-op, historical correction denied.');
 }finally{if(started){sql('BEGIN;'+tables.map(t=>`DELETE FROM school_db.${t} WHERE ${where};`).join('')+'COMMIT;');assert.deepEqual(count(),[0,0,0]);console.log('Temporary attendance rows removed; audit history retained.');}}
})().catch(e=>{console.error(e.message);process.exitCode=1});
