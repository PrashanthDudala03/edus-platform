import assert from 'node:assert/strict'
const base='http://localhost:8081/api/v1',password=process.env.EDUOS_DEMO_TEST_PASSWORD
if(!password)throw Error('Set EDUOS_DEMO_TEST_PASSWORD.')
let checks=0
async function call(path,token,body,method=body?'POST':'GET',expected=200){const r=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(135000)});const j=await r.json().catch(()=>({}));assert.equal(r.status,expected,path+': '+JSON.stringify(j));checks++;return j.data}
async function login(username){return (await call('/auth/login',null,{username,password})).accessToken}
async function ask(token,question){return call('/ai/assistant/ask',token,{question,maxOutputTokens:128})}
const admin=await login('admin@demo.eduos.local')
const status=await call('/ai/status',admin);assert.equal(status.enabled,true,JSON.stringify(status))
const greeting=await ask(admin,'Hello');assert.equal(greeting.available,true);assert.match(greeting.answer,/EduOS AI/i)
const count=await ask(admin,'How many students are in this school?');assert.equal(count.available,true);assert.equal(count.kind,'live');assert(count.sources.length)
const financialStart=performance.now();const financial=await ask(admin,'what is the amount collected?');assert.equal(financial.available,true);assert.equal(financial.kind,'live');assert(financial.sources.length);console.log(JSON.stringify({financialQuestionMilliseconds:Math.round(performance.now()-financialStart),route:financial.kind}));
const general=await ask(admin,'Explain photosynthesis in one short sentence.');assert.equal(general.available,true,JSON.stringify(general));assert.equal(general.kind,'general');assert.match(general.answer,/light|sun|plant/i)
const teachers=await login('teacher@demo.eduos.local');assert.equal((await call('/ai/status',teachers)).enabled,true)
const teacherHello=await ask(teachers,'Hello');assert.equal(teacherHello.available,true)
const parent=await login('parent@demo.eduos.local');assert.equal((await call('/ai/status',parent)).enabled,true)
const parentCount=await ask(parent,'How many students are in this school?');assert.notEqual(parentCount.kind,'live','Scoped parents must not receive school-wide counts')
await call('/ai/status',null,null,'GET',401)
const usage=await call('/ai/usage',admin);assert.equal(usage.monthlyTokenBudget,1000000)
// A temporary synthetic policy proves real embeddings and grounded document answers. Remove afterwards.
let document
try{
 const form=new FormData();form.set('title','QA verification library policy');form.append('audience','school');form.append('audience','teacher');form.append('file',new Blob(['# QA verification library policy\nThe QA verification library return period is seven days. All borrowed QA verification books must be returned within seven days of issue.'],{type:'text/plain'}),'qa-policy.txt')
 const upload=await fetch(base+'/ai/knowledge/documents',{method:'POST',headers:{Authorization:'Bearer '+admin},body:form});const j=await upload.json();assert.equal(upload.status,201,JSON.stringify(j));document=j.data.id;checks++;assert.equal(j.data.status,'ready',JSON.stringify(j))
 const search=await call('/ai/knowledge/search',admin,{query:'The QA verification library return period is seven days.',audience:'school'});assert.equal(search.available,true);assert(search.results.some(s=>s.documentId===document));
 const answer=await ask(admin,'What does the QA verification library policy say about the library return period?');assert.equal(answer.available,true,JSON.stringify(answer));assert.equal(answer.kind,'documents');assert(answer.sources.some(s=>s.documentId===document));assert.match(answer.answer,/seven|7/i)
}finally{if(document)await call('/ai/knowledge/documents/'+document,admin,null,'DELETE',204)}
console.log(JSON.stringify({passed:true,checks,coverage:['greeting','live student counts','local study answer','teacher access','parent scope','authentication','monthly allowance','document embeddings','grounded answer and sources']}))
