const {chromium}=require('../frontend/node_modules/playwright');
const fs=require('fs');
(async()=>{
 const base=process.env.EDUOS_TEST_URL||'http://localhost:8081';
 const r=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'teacher@demo.eduos.local',password:process.env.EDUOS_DEMO_TEST_PASSWORD})});
 if(!r.ok)throw Error('Teacher login failed: '+r.status);const {data}=await r.json();
 const browser=await chromium.launch({executablePath:'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe'});
 const results=[];try{
 const p=await browser.newPage();await p.addInitScript(d=>{localStorage.setItem('accessToken',d.accessToken);localStorage.setItem('refreshToken',d.refreshToken);localStorage.setItem('user',JSON.stringify(d.user));localStorage.setItem('eduos.skipSchoolHome','1');},data);
 let errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=400)errors.push(r.status()+' '+new URL(r.url()).pathname)});
 await p.goto(base+'/teacher');await p.getByRole('heading',{name:'Welcome, Ravi.'}).waitFor();
 const links=await p.locator('.sidebar a.nav-link[href]').evaluateAll(a=>a.map(x=>({path:x.getAttribute('href'),label:x.textContent.trim()})).filter((x,i,all)=>x.path.startsWith('/')&&x.path!='/home'&&all.findIndex(y=>y.path===x.path)===i));
 for(const link of links){errors=[];const start=Date.now();await p.locator('.sidebar a.nav-link').filter({hasText:link.label}).first().click();
 await p.waitForURL(base+link.path);await p.waitForTimeout(400);await p.locator('#main h1').first().waitFor();
 await p.getByText('Loading your workspace…',{exact:true}).waitFor({state:'hidden',timeout:15000});await p.waitForLoadState('networkidle');
 const desktop=await p.locator('#main').innerText();
 await p.setViewportSize({width:390,height:844});const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
 results.push({path:link.path,label:link.label,ms:Date.now()-start,errors:[...errors],overflow,stuck:/Loading your workspace/.test(desktop),heading:await p.locator('#main h1').allTextContents()});console.log(link.path+' checked');
 await p.setViewportSize({width:1440,height:900});
 }
 const status=await p.request.get(base+'/api/v1/suite/fees/summary',{headers:{Authorization:'Bearer '+data.accessToken}});results.push({permissionProbe:'/suite/fees',status:status.status()});
 }finally{await browser.close();}
 fs.writeFileSync('teacher-audit.json',JSON.stringify({date:'2026-10-23',mode:'Read-only navigation; no records changed',results},null,2));console.log(JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
