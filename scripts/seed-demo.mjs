// DEVELOPMENT / DEMO DATA ONLY. Never run this against a real school deployment.
//
// Creates "EduOS Demo School" with one account per role and a small, connected set of
// academic records so every portal has something real to show. Everything is created
// through the public API, so passwords use the normal hashing and every rule is enforced.
// Re-running is safe: each step checks first and never changes an existing account.
//
//   node scripts/seed-demo.mjs --confirm-demo
//
// The demo password is for local development only. It never appears in the frontend bundle.
import {execFileSync} from 'node:child_process'
import path from 'node:path'

const root=path.resolve(import.meta.dirname,'..')
const base=(process.env.EDUOS_TEST_URL||'http://localhost:8080').replace(/\/$/,'')
const PASSWORD=process.env.EDUOS_DEMO_PASSWORD||'EduOS@Demo2026!!'
const SCHOOL='EduOS Demo School'
const accounts={
 SuperAdmin:{username:'superadmin@eduos.local',firstName:'Platform',lastName:'Admin (Demo)'},
 Administrator:{username:'admin@demo.eduos.local',firstName:'Asha',lastName:'Menon (Demo Admin)'},
 Principal:{username:'principal@demo.eduos.local',firstName:'Meera',lastName:'Iyer (Demo Principal)'},
 Teacher:{username:'teacher@demo.eduos.local',firstName:'Ravi',lastName:'Kumar (Demo Teacher)'},
 Parent:{username:'parent@demo.eduos.local',firstName:'Neha',lastName:'Sharma (Demo Parent)'},
 Student:{username:'student@demo.eduos.local',firstName:'Aarav',lastName:'Sharma (Demo Student)'},
}

if(!process.argv.includes('--confirm-demo')){console.error('Refusing to run: add --confirm-demo to create DEMO accounts with a shared development password.');process.exit(2)}
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname)){console.error('Refusing to seed demo accounts on '+base+'. Demo data is for a local development stack only.');process.exit(2)}
if(PASSWORD.length<16){console.error('EDUOS_DEMO_PASSWORD must be at least 16 characters (EduOS password policy).');process.exit(2)}
console.log('*** DEVELOPMENT DEMO SEED · '+base+' · demo accounts share one development password ***')

const day=(offset=0)=>{const d=new Date();d.setDate(d.getDate()+offset);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
async function call(method,url,token,body){
 const r=await fetch(base+'/api/v1'+url,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)})
 const text=await r.text();let json;try{json=text?JSON.parse(text):{}}catch{json={message:text}}
 if(r.status===429){await new Promise(f=>setTimeout(f,6500));return call(method,url,token,body)}
 return {status:r.status,json}
}
async function must(method,url,token,body,ok=[200,201]){const r=await call(method,url,token,body);if(!ok.includes(r.status))throw Error(method+' '+url+' -> '+r.status+' '+JSON.stringify(r.json));return r.json.data}
async function login(username){const r=await call('POST','/auth/login',undefined,{username,password:PASSWORD});return r.status===200?r.json.data.accessToken:null}

// 1. Platform SuperAdmin. auth-service creates it once from EDUOS_PLATFORM_ADMIN_* on start; the
//    variables are passed only for that restart and then removed again, so the password does not
//    stay in the container configuration.
function restartAuth(env){execFileSync('docker',['compose','up','-d','--wait','--wait-timeout','180','auth-service'],{cwd:root,stdio:'inherit',env:{...process.env,...env}})}
let superToken=await login(accounts.SuperAdmin.username)
if(!superToken){
 console.log('Provisioning the demo platform SuperAdmin…')
 restartAuth({EDUOS_PLATFORM_ADMIN_USERNAME:accounts.SuperAdmin.username,EDUOS_PLATFORM_ADMIN_EMAIL:accounts.SuperAdmin.username,EDUOS_PLATFORM_ADMIN_PASSWORD:PASSWORD})
 restartAuth({EDUOS_PLATFORM_ADMIN_USERNAME:'',EDUOS_PLATFORM_ADMIN_EMAIL:'',EDUOS_PLATFORM_ADMIN_PASSWORD:''})
 for(let i=0;i<20&&!superToken;i++){superToken=await login(accounts.SuperAdmin.username);if(!superToken)await new Promise(f=>setTimeout(f,3000))}
 if(!superToken)throw Error('The demo SuperAdmin could not sign in. If superadmin@eduos.local already exists with another password it is left unchanged.')
}

// 2. Demo school and its administrator, created through the platform API.
let school=(await must('GET','/platform/schools?search='+encodeURIComponent(SCHOOL),superToken)).find(s=>s.name===SCHOOL)
if(!school){await must('POST','/platform/schools',superToken,{name:SCHOOL,principalName:'Dr. Meera Iyer (Demo)',subscriptionTier:'trial'});school=(await must('GET','/platform/schools?search='+encodeURIComponent(SCHOOL),superToken)).find(s=>s.name===SCHOOL)}
if(!school.isActive)await must('PUT','/platform/schools/'+school.id,superToken,{isActive:true})
let admin=await login(accounts.Administrator.username)
if(!admin){
 const a=accounts.Administrator,r=await call('POST','/platform/schools/'+school.id+'/administrators',superToken,{username:a.username,email:a.username,firstName:a.firstName,lastName:a.lastName,password:PASSWORD})
 if(r.status!==201)throw Error('Could not create the demo administrator ('+r.status+' '+JSON.stringify(r.json)+'). An existing account is never overwritten.')
 admin=await login(a.username)
}
const schoolId=school.id

// 3. Principal, teacher, parent and student accounts in the demo school.
const roles=Object.fromEntries((await must('GET','/roles',admin)).map(r=>[r.name,r.id]))
const existing=(await must('GET','/users?pageSize=100',admin)).data
const userIds={}
for(const role of ['Principal','Teacher','Parent','Student']){
 const a=accounts[role],found=existing.find(u=>u.username===a.username)
 userIds[role]=found?.id??(await must('POST','/users',admin,{schoolId,roleId:roles[role],username:a.username,email:a.username,firstName:a.firstName,lastName:a.lastName,password:PASSWORD},[201])).id
}

// Pending access requests for the signup review demo. They go through the public signup endpoint
// with the school's signup code, exactly as a real applicant would. 409 means one already exists.
const signupCode=(await must('GET','/control/configuration',admin)).boundary.signupCode
const pendingSignups={Teacher:'pending.teacher@demo.eduos.local',Parent:'pending.parent@demo.eduos.local',Student:'pending.student@demo.eduos.local'}
for(const [requestedRole,email] of Object.entries(pendingSignups))
 await must('POST','/auth/signup',undefined,{email,password:PASSWORD,firstName:'Pending',lastName:requestedRole+' (Demo)',phone:'9000000300',schoolCode:signupCode,requestedRole},[201,409])

// 4. Academic records. ensure() finds a record by a unique value before creating it.
const records=async(kind,token=admin,search='')=>(await must('GET','/suite/records/'+kind+(search?'?search='+encodeURIComponent(search):''),token)).data
// listToken lets the administrator check for records the creating role cannot read back (a teacher's sent messages).
async function ensure(kind,match,body,token=admin,listToken=token){const found=(await records(kind,listToken)).find(match);return found?found.id:(await must('POST','/suite/records/'+kind,token,body,[201])).id}
const directory=async(kind,search)=>(await must('GET','/operations/directory/'+kind+'?search='+encodeURIComponent(search),admin)).data
async function teacherProfile(code,firstName,lastName,email,department){const found=(await directory('teachers',email))[0];return found?.id??(await must('POST','/teachers',admin,{schoolId,employeeCode:code,firstName,lastName,email,phoneNumber:'9000000'+code.slice(-3),department},[201])).id}

const now=new Date(),startYear=now.getMonth()>=3?now.getFullYear():now.getFullYear()-1
const yearName=startYear+'-'+String(startYear+1).slice(2)+' (Demo)'
const year=await ensure('academic-years',r=>r.name===yearName,{name:yearName,startsOn:startYear+'-04-01',endsOn:(startYear+1)+'-03-31',status:'Current'})
const ravi=await teacherProfile('DEMO-T-001','Ravi','Kumar',accounts.Teacher.username,'Mathematics')
const sunita=await teacherProfile('DEMO-T-002','Sunita','Rao','sunita.rao@demo.eduos.local','English')
const grade6=await ensure('classes',r=>r.name==='Grade 6'&&r.section==='A',{name:'Grade 6',section:'A',yearId:year,teacherId:ravi,capacity:40})
const grade3=await ensure('classes',r=>r.name==='Grade 3'&&r.section==='B',{name:'Grade 3',section:'B',yearId:year,teacherId:sunita,capacity:40})
const maths=await ensure('subjects',r=>r.code==='MATH',{name:'Mathematics',code:'MATH'})
const science=await ensure('subjects',r=>r.code==='SCI',{name:'Science',code:'SCI'})
const english=await ensure('subjects',r=>r.code==='ENG',{name:'English',code:'ENG'})
for(const [cl,subject,teacher] of [[grade6,maths,ravi],[grade6,science,ravi],[grade3,english,sunita]])
 await ensure('teaching-assignments',r=>r.classId===cl&&r.subjectId===subject&&r.teacherId===teacher,{classId:cl,subjectId:subject,teacherId:teacher})

// Two siblings with one guardian: Aarav (student login) in Grade 6-A, Diya in Grade 3-B.
async function admit(number,firstName,gender,dob,cl){
 const id=await ensure('admissions',r=>r.admissionNumber===number,{admissionNumber:number,firstName,lastName:'Sharma',dateOfBirth:dob,gender,email:firstName.toLowerCase()+'.sharma@demo.eduos.local',phoneNumber:'9000000201',guardianName:'Neha Sharma',guardianEmail:accounts.Parent.username,guardianPhone:'9000000202',address:'12 Demo Lane, Bengaluru',classId:cl,status:'Submitted'})
 const row=(await records('admissions',admin,number)).find(r=>r.id===id)
 return row.status==='Accepted'?row.studentId:(await must('POST','/suite/admissions/'+id+'/accept',admin)).studentId
}
const aarav=await admit('DEMO-2026-001','Aarav','Male','2014-06-15',grade6)
const diya=await admit('DEMO-2026-002','Diya','Female','2017-09-02',grade3)
await ensure('account-links',r=>r.userId===userIds.Teacher,{userId:userIds.Teacher,teacherId:ravi})
await ensure('account-links',r=>r.userId===userIds.Parent&&r.studentId===aarav,{userId:userIds.Parent,studentId:aarav})
await ensure('account-links',r=>r.userId===userIds.Parent&&r.studentId===diya,{userId:userIds.Parent,studentId:diya})
await ensure('account-links',r=>r.userId===userIds.Student,{userId:userIds.Student,studentId:aarav})
// Linking a profile revokes that account's sessions, so the teacher and student sign in only after their links exist.
const teacherToken=await login(accounts.Teacher.username),studentToken=await login(accounts.Student.username)

// Weekly timetable: Grade 6-A Monday to Saturday, Grade 3-B Monday to Friday.
const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const periods=await records('timetable')
for(const d of days){
 for(const [cl,subject,teacher,start,end,room] of [[grade6,maths,ravi,'09:00','09:45','6A'],[grade6,science,ravi,'10:00','10:45','Lab 1'],...(d!=='Saturday'?[[grade3,english,sunita,'09:00','09:45','3B']]:[])])
  if(!periods.some(p=>p.classId===cl&&p.day===d&&p.startsAt===start))await must('POST','/suite/records/timetable',admin,{classId:cl,subjectId:subject,teacherId:teacher,day:d,startsAt:start,endsAt:end,room},[201])
}

// Exams: marks are entered while Draft, then the exam is published so families can see results.
async function exam(name,cl,subject,date,max,pass,marks){
 const id=await ensure('exams',r=>r.name===name&&r.classId===cl&&r.subjectId===subject,{name,classId:cl,subjectId:subject,date,maxMarks:max,passMarks:pass,status:'Draft'})
 for(const [student,score,remarks] of marks)await ensure('marks',r=>r.examId===id&&r.studentId===student,{examId:id,studentId:student,score,remarks})
 const row=(await records('exams')).find(r=>r.id===id)
 if(row.status!=='Published')await must('PUT','/suite/records/exams/'+id,admin,{name,classId:cl,subjectId:subject,date,maxMarks:max,passMarks:pass,status:'Published',version:row.version})
}
await exam('Unit Test 1 (Demo)',grade6,maths,day(-12),50,20,[[aarav,42,'Strong algebra work. (demo)']])
await exam('Unit Test 1 (Demo)',grade6,science,day(-10),50,20,[[aarav,38,'Good lab observations. (demo)']])
await exam('Unit Test 1 (Demo)',grade3,english,day(-11),50,20,[[diya,45,'Excellent reading. (demo)']])
await exam('Half-Yearly Exam (Demo)',grade6,maths,day(14),100,35,[])
await exam('Half-Yearly Exam (Demo)',grade3,english,day(15),100,35,[])

// Homework set by the teacher account; one submission with feedback, one still open.
const fractions=await ensure('homework',r=>r.title==='Fractions worksheet (Demo)',{title:'Fractions worksheet (Demo)',classId:grade6,subjectId:maths,dueDate:day(3),instructions:'Complete questions 1-10 on adding and subtracting fractions.'},teacherToken)
await ensure('homework',r=>r.title==='Plant cell diagram (Demo)',{title:'Plant cell diagram (Demo)',classId:grade6,subjectId:science,dueDate:day(5),instructions:'Draw and label a plant cell.'},teacherToken)
await ensure('homework',r=>r.title==='Reading log (Demo)',{title:'Reading log (Demo)',classId:grade3,subjectId:english,dueDate:day(4),instructions:'Read for 15 minutes each day and note one new word.'})
const submission=await ensure('submissions',r=>r.homeworkId===fractions&&r.studentId===aarav,{homeworkId:fractions,studentId:aarav,response:'All ten questions done; I found question 7 tricky.'},studentToken)
const sub=(await records('submissions',teacherToken)).find(r=>r.id===submission)
if(!sub.feedback)await must('PUT','/suite/records/submissions/'+submission,teacherToken,{...sub,feedback:'Well done. Review common denominators for question 7.',grade:'A-'})

// Communication, calendar, fees, attendance and documents.
await ensure('circulars',r=>r.title==='Parent-teacher meeting (Demo)',{title:'Parent-teacher meeting (Demo)',message:'Meet your child’s class teacher on Saturday between 9 and 12. Please acknowledge.',audience:'All',dueDate:day(7)})
await ensure('circulars',r=>r.title==='Sports day volunteers (Demo)',{title:'Sports day volunteers (Demo)',message:'We are looking for parent volunteers for sports day.',audience:'Parent'})
await ensure('calendar',r=>r.title==='Sports Day (Demo)',{title:'Sports Day (Demo)',startsOn:day(10),endsOn:day(10),description:'Annual sports day for all classes.'})
await ensure('messages',r=>r.title==='Homework reminder (Demo)',{title:'Homework reminder (Demo)',message:'Aarav’s plant cell diagram is due this week.',recipientUserId:userIds.Parent},teacherToken,admin)
await ensure('leave-requests',r=>r.teacherId===ravi,{teacherId:ravi,fromDate:day(20),toDate:day(21),reason:'Family function (demo).',status:'Pending'},teacherToken)
const fee6=await ensure('fee-structures',r=>r.name==='Term 1 Tuition (Demo)'&&r.classId===grade6,{name:'Term 1 Tuition (Demo)',classId:grade6,amount:'15000',installment:'Term 1',dueDate:day(15)})
const fee3=await ensure('fee-structures',r=>r.name==='Term 1 Tuition (Demo)'&&r.classId===grade3,{name:'Term 1 Tuition (Demo)',classId:grade3,amount:'12000',installment:'Term 1',dueDate:day(15)})
const fees=await must('GET','/suite/fees',admin)
for(const [student,structure,concession] of [[aarav,fee6,'1000'],[diya,fee3,'0']])
 if(!fees.some(f=>f.studentId===student))await must('POST','/suite/fees/charges',admin,{studentId:student,structureId:structure,concession},[201])
const aaravCharge=(await must('GET','/suite/fees',admin)).find(f=>f.studentId===aarav)
// One part payment for Aarav; skipped when any payment already exists so a re-run never records a second one.
if(!(await must('GET','/suite/fees/payments',admin)).some(p=>p.studentId===aarav))
 await must('POST','/suite/fees/payments',admin,{idempotencyKey:crypto.randomUUID(),chargeId:aaravCharge.id,amount:'7000',method:'Cash',reference:'',paidOn:day(-2)},[201])
for(let offset=-6;offset<=0;offset++){
 const d=new Date();d.setDate(d.getDate()+offset);if(d.getDay()===0)continue
 await must('POST','/suite/student-attendance',admin,{day:day(offset),entries:[{studentId:aarav,status:offset===-3?'Late':'Present'},{studentId:diya,status:offset===-4?'Absent':'Present'}]})
}
for(const teacher of [ravi,sunita])await ensure('staff-attendance',r=>r.teacherId===teacher&&r.day===day(0),{teacherId:teacher,day:day(0),status:'Present'})
await ensure('certificates',r=>r.studentId===aarav&&r.type==='Student ID',{studentId:aarav,type:'Student ID',issuedOn:day(0),remarks:'DEMO record. Not an official document.'})
await ensure('certificates',r=>r.studentId===aarav&&r.type==='Bonafide certificate',{studentId:aarav,type:'Bonafide certificate',issuedOn:day(0),remarks:'DEMO record. Not an official document.'})
const notices=await must('GET','/operations/announcements',admin)
if(!notices.some(n=>n.title==='Welcome to the EduOS demo'))await must('POST','/operations/announcements',admin,{title:'Welcome to the EduOS demo',body:'This school contains development demo data only.',priority:'Normal'},[200,201])
await ensure('school-config',()=>true,{name:SCHOOL,address:'12 Demo Lane, Bengaluru',phone:'+91 80 0000 0000',currency:'INR',gradeA:90,gradeB:75,gradeC:60,gradeD:40,printFooter:'DEMO DATA. Not an official document.'})

console.log('\nDemo school ready: '+SCHOOL+' ('+schoolId+')')
console.log('All demo accounts use the development password shown in docs/DEMO.md.')
for(const [role,a] of Object.entries(accounts))console.log('  '+role.padEnd(14)+a.username)
console.log('\nSchool signup code: '+signupCode)
for(const [role,email] of Object.entries(pendingSignups))console.log('  Pending '+role.padEnd(9)+email)
