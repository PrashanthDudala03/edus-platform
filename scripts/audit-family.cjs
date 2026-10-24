const {chromium}=require('../frontend/node_modules/playwright'),assert=require('node:assert/strict'),fs=require('fs');
const base='http://localhost:8081',results=[];
async function get(path,token,expected=200){const r=await fetch(base+'/api/v1'+path,{headers:{Authorization:'Bearer '+token}});assert.equal(r.status,expected,path);return r.status===200?(await r.json()).data:null;}
(async()=>{
const b=await chromium.launch({executablePath:'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe'});
let parentKids,studentKids,studentToken;
try{for(const role of ['parent','student']){
 const login=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:role+'@demo.eduos.local',password:process.env.EDUOS_DEMO_TEST_PASSWORD})});assert.equal(login.status,200);const {data}=await login.json(),token=data.accessToken;
 const kids=(await get('/suite/options',token)).students;assert(kids.length);if(role==='parent')parentKids=kids;else{studentKids=kids;studentToken=token;assert.equal(kids.length,1);}
 const p=await b.newPage({viewport:{width:1440,height:900}});await p.addInitScript(d=>{for(const k of ['accessToken','refreshToken'])localStorage.setItem(k,d[k]);localStorage.setItem('user',JSON.stringify(d.user));localStorage.setItem('eduos.skipSchoolHome','1');},data);
 let errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=400)errors.push(r.status()+' '+new URL(r.url()).pathname)});
 await p.goto(base+'/'+role);await p.locator('#main .child-profile').waitFor();
 if(role==='parent'&&kids.length>1){for(const kid of kids){await p.getByLabel('Choose child',{exact:true}).selectOption(kid.id);await p.locator('.child-profile h2').filter({hasText:kid.label}).waitFor();const href=await p.locator('.child-profile a').getAttribute('href');assert.equal(href,'/student360/'+kid.id);}results.push({role,childSwitching:kids.length});}
 const links=await p.locator('.sidebar a.nav-link[href]').evaluateAll(a=>a.map(x=>({path:x.getAttribute('href'),label:x.textContent.trim()})).filter((x,i,all)=>x.path.startsWith('/')&&x.path!='/home'&&all.findIndex(y=>y.path===x.path)===i));
 for(const link of links){errors=[];await p.locator('.sidebar a.nav-link').filter({hasText:link.label}).first().click();await p.waitForTimeout(400);await p.locator('#main h1').first().waitFor();await p.getByText('Loading your workspace…',{exact:true}).waitFor({state:'hidden',timeout:15000});await p.waitForLoadState('networkidle');await p.setViewportSize({width:390,height:844});
 const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);results.push({role,path:link.path,errors:[...errors],overflow,heading:await p.locator('#main h1').allTextContents()});console.log(role+' '+link.path+' '+(errors.length||overflow?'ISSUE':'OK'));await p.setViewportSize({width:1440,height:900});}
 for(const kid of kids){const ledger=await get('/suite/fees/ledger/'+kid.id,token);assert(ledger);await get('/suite/report-cards/'+kid.id,token);}
 await get('/suite/fees/summary',token,403);await get('/suite/leave/queue',token,403);
 await p.close();
 }
 const sibling=parentKids.find(k=>!studentKids.some(s=>s.id===k.id));if(sibling){await get('/suite/students/'+sibling.id+'/360',studentToken,403);await get('/suite/fees/ledger/'+sibling.id,studentToken,403);results.push({studentSiblingAccess:'denied'});}
 }finally{await b.close();fs.writeFileSync('family-audit.json',JSON.stringify({date:'2026-10-23',mode:'read-only; no receipts/read state changed',results},null,2));}
 assert(!results.some(r=>r.overflow||r.errors?.length),'Navigation issues found; see family-audit.json');console.log('Family navigation and API scope checks passed.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
