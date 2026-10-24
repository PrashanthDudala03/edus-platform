const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process');const base='http://localhost:8081/api/v1';
async function call(path,t,body,status=200){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();assert.equal(r.status,status,path+': '+text.slice(0,300));return text?JSON.parse(text).data:null;}
const sql=q=>execFileSync('docker',['exec','-i','eduos-postgres-1','sh','-c','exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At'],{input:q,encoding:'utf8'}).trim();
(async()=>{const login=async name=>call('/auth/login',null,{username:name+'@demo.eduos.local',password:process.env.EDUOS_DEMO_TEST_PASSWORD});const [admin,teacher]=await Promise.all(['admin','teacher'].map(login));const t=admin.accessToken,school=admin.user.schoolId;assert.match(school,/^[a-f0-9-]{36}$/i);const options=await call('/suite/options',t),students=[],classes=[],tag=randomUUID().slice(0,8);
try{
for(const capacity of [2,1]){const row=await call('/suite/records/classes',t,{name:'QA '+tag+' '+capacity,section:'A',yearId:options['academic-years'][0].id,teacherId:options.teachers[0].id,capacity},201);assert.match(row.id,/^[a-f0-9-]{36}$/i);classes.push(row.id);}
for(let i=0;i<2;i++){const row=await call('/students',t,{schoolId:school,firstName:'QA'+tag,lastName:'Pupil'+i,email:tag+i+'@example.test',dateOfBirth:'2014-03-12T00:00:00Z',rollNumber:'QA-'+tag+'-'+i,currentClass:'QA unallocated'},201);assert.match(row.id,/^[a-f0-9-]{36}$/i);students.push(row.id);}
await call('/suite/allocate',t,{studentIds:[],classId:classes[0]},400);
await call('/suite/allocate',t,{studentIds:students,classId:classes[0]});
await call('/suite/allocate',t,{studentIds:students,classId:classes[1]},409);
let rows=await call('/suite/allocations',t);assert(students.every(id=>rows.some(r=>r.studentId===id&&r.classId===classes[0])),'Capacity failure must roll back all moves');
await call('/suite/allocate',teacher.accessToken,{studentIds:[students[0]],classId:classes[1]},403);
await call('/suite/allocate',t,{studentIds:[students[0]],classId:classes[1]});await call('/suite/allocate',t,{studentIds:[students[0]],classId:classes[1]});
rows=await call('/suite/allocations',t);assert(rows.some(r=>r.studentId===students[0]&&r.classId===classes[1]));assert(rows.some(r=>r.studentId===students[1]&&r.classId===classes[0]));
const directory=await call('/operations/directory/students?search='+tag,t);assert.equal(directory.data.find(s=>s.id===students[0]).currentClass,'QA '+tag+' 1 - A');
await call('/suite/allocate',t,{studentIds:['invalid-id'],classId:classes[1]},400);
console.log('Allocation passed: empty/invalid selections, initial placement, atomic capacity rollback, teacher denial, promotion/reload, repeat move and directory consistency.');
}finally{const ids=students.map(id=>"'"+id+"'").join(',');const cls=classes.map(id=>"'"+id+"'").join(',');sql('BEGIN;'+(ids?`DELETE FROM suite.student_classes WHERE school_id='${school}' AND student_id IN(${ids});DELETE FROM student_db.students WHERE school_id='${school}' AND id IN(${ids});`:'')+(cls?`DELETE FROM suite.records WHERE school_id='${school}' AND kind='classes' AND id IN(${cls});`:'')+'COMMIT;');console.log('Temporary pupils/classes removed; audit retained.');}
})().catch(e=>{console.error(e.message);process.exitCode=1});
