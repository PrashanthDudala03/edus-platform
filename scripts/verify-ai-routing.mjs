import assert from 'node:assert/strict';
const base='http://localhost:8081/api/v1';
async function call(path,token,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,200);return(await r.json()).data;}
const login=async username=>(await call('/auth/login',null,{username,password:process.env.EDUOS_DEMO_TEST_PASSWORD})).accessToken;
const admin=await login('admin@demo.eduos.local');
for(const question of ['total number of teachers?','How big is our teaching team?','How big is our teaching team?','List the instructors working here']){
 const before=(await call('/ai/usage',admin)).tokensUsed,start=performance.now();
 const r=await call('/ai/assistant/ask',admin,{question});
 const tokens=(await call('/ai/usage',admin)).tokensUsed-before;
 console.log(JSON.stringify({question,milliseconds:Math.round(performance.now()-start),tokens,answer:r.answer}));
 assert.equal(r.kind,'live');
 if(question.includes('instructors')){assert.match(r.answer,/Ravi Kumar/);assert.match(r.answer,/Sunita Rao/);}
 else {assert.match(r.answer,/Staff directory: 2 record/);}
}
const parent=await login('parent@demo.eduos.local');
const denied=await call('/ai/assistant/ask',parent,{question:'How big is our teaching team?'});
assert.notEqual(denied.kind,'live');assert.doesNotMatch(denied.answer,/Ravi Kumar|Sunita Rao/);
console.log('Permission isolation passed.');
