import {test,expect,APIRequestContext,APIResponse} from '@playwright/test'
import {randomUUID,createHmac} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {createServer,Server} from 'node:http'
import path from 'node:path'
import {clearIamSql} from './iam-fixtures'

// Payment tests never contact Razorpay. They run when the stack was started with test-only values:
//   RAZORPAY_KEY_ID=rzp_test_eduos RAZORPAY_KEY_SECRET=<any> RAZORPAY_WEBHOOK_SECRET=<any> RAZORPAY_API_BASE=http://host.docker.internal:18099
// and the same variables are visible to Playwright, which serves the fake order API on that port.
const root=path.resolve(import.meta.dirname,'../..')
const env=Object.fromEntries(readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(x=>x&&!x.startsWith('#')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)]}))
const password=env.EDUOS_BOOTSTRAP_ADMIN_PASSWORD,demoPassword=process.env.EDUOS_DEMO_PASSWORD||'EduOS@Demo2026!!',tag=randomUUID().slice(0,8)
const keySecret=process.env.RAZORPAY_KEY_SECRET||'',hookSecret=process.env.RAZORPAY_WEBHOOK_SECRET||'',apiBase=process.env.RAZORPAY_API_BASE||''
const payments=!!(keySecret&&hookSecret&&apiBase),platformId='00000000-0000-0000-0000-00000000e005',day=86400000
const sign=(data:string,secret:string)=>createHmac('sha256',secret).update(data).digest('hex')
const at=(offset:number)=>new Date(Date.now()+offset*day).toISOString()
const code=(name:string)=>(name+'-'+tag).toUpperCase()
let api:APIRequestContext,mock:Server|undefined,platform:any,adminA:any,adminB:any,parent:any,A='',B='',standard='',pro='',disabled='',coupon25='',order1:any,order2:any
const orders:{body:any,authorization:string}[]=[]
async function login(username:string,pw=password){for(let i=0;i<20;i++){const r=await api.post('/api/v1/auth/login',{data:{username,password:pw}});if(r.status()===429){await new Promise(f=>setTimeout(f,6500));continue}expect(r.status(),await r.text()).toBe(200);return(await r.json()).data}throw Error('Login throttled')}
const call=async(session:any,method:string,url:string,data?:unknown,headers:Record<string,string>={}):Promise<APIResponse>=>{for(let i=0;;i++){const r=await api.fetch('/api/v1'+url,{method,headers:{...(session?{Authorization:'Bearer '+session.accessToken}:{}),...headers},...(data===undefined?{}:{data})});if(r.status()!==429||i>=15)return r;await new Promise(f=>setTimeout(f,6500))}}
async function ok(session:any,method:string,url:string,data?:unknown,status=200){const r=await call(session,method,url,data);expect(r.status(),method+' '+url+' '+await r.text()).toBe(status);return(await r.json()).data}
async function denied(session:any,method:string,url:string,data?:unknown,status=403,message?:RegExp){const r=await call(session,method,url,data);expect(r.status(),method+' '+url+' '+await r.text()).toBe(status);if(message)expect((await r.json()).message).toMatch(message)}
const psql=(query:string)=>execFileSync('docker',['compose','exec','-T','postgres','psql','-U',env.POSTGRES_USER,'-d',env.POSTGRES_DB,'-v','ON_ERROR_STOP=1','-c',query],{cwd:root,stdio:'pipe'})
const current=async(session:any)=>ok(session,'GET','/subscription/current')
const quote=(session:any,planId:string,coupon?:string)=>ok(session,'POST','/subscription/quote',{planId,coupon})
const manage=(school:string,body:unknown,status=200)=>call(platform,'POST','/billing/schools/'+school+'/subscription',body).then(async r=>expect(r.status(),await r.text()).toBe(status))
const offer=(body:Record<string,unknown>,status=201)=>ok(platform,'POST','/billing/offers',{name:'QA offer '+tag,discountType:'percent',discountValue:10,startsAt:at(-1),endsAt:at(7),status:'Active',...body},status)
const history=async(school:string)=>(await ok(platform,'GET','/control/access-history?targetSchool='+school)).map((a:any)=>a.action)
async function webhook(event:string,orderId:string,paymentId:string,amount:number,options:{eventId?:string,signature?:string,error?:string}={}){
 const body=JSON.stringify({event,payload:{payment:{entity:{id:paymentId,order_id:orderId,amount,currency:'INR',error_description:options.error}}}})
 const r=await call(null,'POST','/billing/webhooks/razorpay',body,{'Content-Type':'application/json','X-Razorpay-Signature':options.signature??sign(body,hookSecret),'X-Razorpay-Event-Id':options.eventId||randomUUID()})
 return{status:r.status(),body:await r.json()}
}
const session=(s:any)=>(store:any)=>{localStorage.setItem('accessToken',store.accessToken);localStorage.setItem('refreshToken',store.refreshToken);localStorage.setItem('user',JSON.stringify(store.user))}

test.describe.serial('Subscriptions, pricing, offers and payments',()=>{
 test.beforeAll(async({playwright})=>{
  test.setTimeout(180000);api=await playwright.request.newContext({baseURL:process.env.EDUOS_TEST_URL||'http://localhost:8080'})
  if(payments){
   mock=createServer((request,response)=>{let raw='';request.on('data',c=>raw+=c);request.on('end',()=>{
    if(request.method!=='POST'||request.url!=='/v1/orders'){response.writeHead(404).end();return}
    const body=JSON.parse(raw);orders.push({body,authorization:String(request.headers.authorization)})
    response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({id:'order_'+randomUUID().replaceAll('-','').slice(0,14),amount:body.amount,currency:body.currency,status:'created'}))})})
   await new Promise<void>(done=>mock!.listen(Number(new URL(apiBase).port),process.platform==='linux'?'0.0.0.0':'127.0.0.1',done))
  }
  platform=await login('superadmin@eduos.local',demoPassword);parent=await login('parent@demo.eduos.local',demoPassword)
  A=(await ok(platform,'POST','/platform/schools',{name:'Billing QA '+tag},201)).id;B=(await ok(platform,'POST','/platform/schools',{name:'Billing QA other '+tag},201)).id
  for(const [school,name] of [[A,'billing-a-'],[B,'billing-b-']])await ok(platform,'POST','/platform/schools/'+school+'/administrators',{username:name+tag,email:name+tag+'@example.test',firstName:'Billing',lastName:'Admin',password},201)
  adminA=await login('billing-a-'+tag);adminB=await login('billing-b-'+tag)
 })
 test.afterAll(async()=>{
  await new Promise(done=>mock?mock.close(done):done(null))
  if(A&&B){
   const tables=['billing.payments','billing.school_prices','billing.subscriptions','suite.records','auth_db.password_resets','auth_db.refresh_tokens','auth_db.users']
   psql('BEGIN; '+[A,B].map(id=>clearIamSql(id)+tables.map(t=>`DELETE FROM ${t} WHERE school_id='${id}';`).join(' ')+`DELETE FROM auth_db.role_permissions WHERE role_id IN(SELECT id FROM auth_db.roles WHERE school_id='${id}');DELETE FROM auth_db.roles WHERE school_id='${id}';DELETE FROM school_db.schools WHERE id='${id}';`).join(' ')
    +`DELETE FROM billing.offers WHERE name LIKE '%${tag}';DELETE FROM billing.banners WHERE title LIKE '%${tag}';DELETE FROM billing.plans WHERE name LIKE '%${tag}';UPDATE billing.settings SET grace_days=7;DELETE FROM auth_db.iam_audit WHERE action LIKE 'billing.%' AND school_id='${platformId}' AND new_value::text LIKE '%${tag}%';COMMIT;`)
  }
  await api?.dispose()
 })

 test('plans are created and priced by the platform',async()=>{
  const plan={name:'QA Standard '+tag,description:'Everything a school needs',status:'Active',billingPeriod:'yearly',basePrice:3000000,currency:'INR',trialDays:14,features:['Attendance','Fees'],displayOrder:1,highlighted:true}
  standard=(await ok(platform,'POST','/billing/plans',plan,201)).id
  pro=(await ok(platform,'POST','/billing/plans',{...plan,name:'QA Pro '+tag,billingPeriod:'monthly',basePrice:500000,highlighted:false},201)).id
  disabled=(await ok(platform,'POST','/billing/plans',{...plan,name:'QA Retired '+tag,status:'Disabled'},201)).id
  await denied(platform,'POST','/billing/plans',plan,409)
  await denied(platform,'POST','/billing/plans',{...plan,name:'QA Negative '+tag,basePrice:-1},400)
  await denied(platform,'POST','/billing/plans',{...plan,name:'QA Period '+tag,billingPeriod:'weekly'},400)
  await ok(platform,'PUT','/billing/plans/'+standard,{...plan,basePrice:3100000})
  expect((await ok(platform,'GET','/billing/plans')).find((p:any)=>p.id===standard).basePrice).toBe(3100000)
  await ok(platform,'PUT','/billing/plans/'+standard,plan)
  const actions=await history(platformId)
  expect(actions).toContain('billing.plan.created');expect(actions).toContain('billing.plan.price_changed')
 })

 test('school roles cannot reach or change platform billing',async()=>{
  for(const who of [adminA,parent]){
   for(const url of ['/billing/overview','/billing/plans','/billing/offers','/billing/subscriptions','/billing/payments','/billing/settings'])await denied(who,'GET',url)
   await denied(who,'POST','/billing/plans',{name:'Mine '+tag,status:'Active',billingPeriod:'yearly',basePrice:1})
   await denied(who,'PUT','/billing/plans/'+standard,{name:'QA Standard '+tag,status:'Active',billingPeriod:'yearly',basePrice:1})
   await denied(who,'POST','/billing/offers',{name:'Mine '+tag,discountType:'percent',discountValue:100,startsAt:at(-1),endsAt:at(1),status:'Active'})
   await denied(who,'POST','/billing/schools/'+A+'/subscription',{action:'complimentary'})
   await denied(who,'PUT','/billing/schools/'+A+'/prices/'+standard,{price:0})
   await denied(who,'PUT','/billing/settings',{graceDays:90})
  }
  await denied(null,'GET','/billing/plans',undefined,401);await denied(null,'GET','/subscription/current',undefined,401)
  await denied(parent,'GET','/subscription/current');await denied(parent,'POST','/subscription/checkout',{planId:standard})
  await denied(platform,'GET','/subscription/current')
  expect((await ok(platform,'GET','/billing/plans')).find((p:any)=>p.id===standard).basePrice).toBe(3000000)
  const view=await current(adminA)
  expect(view.subscription).toMatchObject({effectiveStatus:'None',planId:null});expect(view.subscription).not.toHaveProperty('overrides')
  expect(view.plans.map((p:any)=>p.id)).toEqual(expect.arrayContaining([standard,pro]));expect(view.plans.map((p:any)=>p.id)).not.toContain(disabled)
  expect(view.plans.find((p:any)=>p.id===standard).quote).toMatchObject({basePrice:3000000,discount:0,finalAmount:3000000,currency:'INR'})
 })

 test('offers are validated and only eligible discounts apply',async()=>{
  coupon25=(await offer({name:'QA Diwali '+tag,code:code('qa25'),discountValue:25})).id
  expect(await quote(adminA,standard,code('qa25').toLowerCase())).toMatchObject({basePrice:3000000,discount:750000,finalAmount:2250000,offerId:coupon25})
  await offer({code:code('qafix'),discountType:'fixed',discountValue:500000})
  expect(await quote(adminA,standard,code('qafix'))).toMatchObject({discount:500000,finalAmount:2500000})
  await offer({code:code('qabig'),discountType:'fixed',discountValue:99999999})
  expect(await quote(adminA,standard,code('qabig'))).toMatchObject({discount:3000000,finalAmount:0})
  for(const bad of [{discountValue:101},{discountValue:0},{discountType:'fixed',discountValue:0},{discountType:'half'},{endsAt:at(-2)},{code:'a b'},{planIds:[randomUUID()]},{schoolIds:[randomUUID()]}])await offer({code:code('qabad'),...bad},400)
  await offer({code:code('qa25')},409)
  await offer({code:code('qaold'),startsAt:at(-9),endsAt:at(-2)});await denied(adminA,'POST','/subscription/quote',{planId:standard,coupon:code('qaold')},400,/expired/)
  await offer({code:code('qasoon'),startsAt:at(2),endsAt:at(9)});await denied(adminA,'POST','/subscription/quote',{planId:standard,coupon:code('qasoon')},400,/not started/)
  await offer({code:code('qaoff'),status:'Disabled'});await denied(adminA,'POST','/subscription/quote',{planId:standard,coupon:code('qaoff')},400,/not active/)
  await offer({code:code('qab'),discountValue:50,schoolIds:[B]});await denied(adminA,'POST','/subscription/quote',{planId:standard,coupon:code('qab')},400,/not available to your school/)
  expect((await quote(adminB,standard,code('qab'))).finalAmount).toBe(1500000)
  await offer({code:code('qapro'),planIds:[pro]});await denied(adminA,'POST','/subscription/quote',{planId:standard,coupon:code('qapro')},400,/selected plan/)
  await denied(adminA,'POST','/subscription/quote',{planId:standard,coupon:'NOPE-'+tag},400,/not valid/)
  await denied(adminA,'POST','/subscription/quote',{planId:disabled},404)
  // An automatic promotion needs no coupon, and the better discount wins.
  const sale={name:'QA automatic sale '+tag,discountType:'percent',discountValue:10,startsAt:at(-1),endsAt:at(7),planIds:[standard]}
  const automatic=(await ok(platform,'POST','/billing/offers',{...sale,status:'Active'},201)).id
  expect(await quote(adminA,standard)).toMatchObject({discount:300000,finalAmount:2700000,offerId:automatic})
  expect((await current(adminA)).plans.find((p:any)=>p.id===standard).quote.finalAmount).toBe(2700000)
  expect((await quote(adminA,standard,code('qa25'))).finalAmount).toBe(2250000)
  await ok(platform,'PUT','/billing/offers/'+automatic,{...sale,status:'Disabled'})
  expect((await quote(adminA,standard)).finalAmount).toBe(3000000)
  const listed=await ok(platform,'GET','/billing/offers')
  expect(listed.find((o:any)=>o.code===code('qaold')).state).toBe('Expired');expect(listed.find((o:any)=>o.code===code('qasoon')).state).toBe('Scheduled')
  expect(await history(platformId)).toEqual(expect.arrayContaining(['billing.offer.created','billing.offer.changed']))
 })

 test('a school price overrides the plan price and is audited',async()=>{
  await ok(platform,'PUT','/billing/schools/'+A+'/prices/'+standard,{price:2500000,note:'Founding school'})
  expect(await quote(adminA,standard)).toMatchObject({basePrice:2500000,finalAmount:2500000})
  expect(await quote(adminA,standard,code('qa25'))).toMatchObject({basePrice:2500000,discount:625000,finalAmount:1875000})
  expect((await quote(adminB,standard)).basePrice).toBe(3000000)
  await denied(platform,'PUT','/billing/schools/'+A+'/prices/'+standard,{price:-5},400);await denied(platform,'PUT','/billing/schools/'+randomUUID()+'/prices/'+standard,{price:5},404)
  await ok(platform,'PUT','/billing/schools/'+B+'/prices/'+pro,{price:0});expect((await quote(adminB,pro)).finalAmount).toBe(0)
  await ok(platform,'PUT','/billing/schools/'+B+'/prices/'+pro,{price:null});expect((await quote(adminB,pro)).finalAmount).toBe(500000)
  expect((await ok(platform,'GET','/billing/subscriptions')).find((s:any)=>s.schoolId===A).overrides).toEqual([expect.objectContaining({planId:standard,price:2500000})])
  expect(await history(A)).toContain('billing.price.overridden')
 })

 test('the platform grants, extends, cancels and restores access without any payment',async()=>{
  await manage(B,{action:'complimentary',note:'Partner school'})
  expect((await current(adminB)).subscription).toMatchObject({effectiveStatus:'Complimentary',endsAt:null,finalAmount:0,paymentState:'NotRequired'})
  await manage(B,{action:'trial'},400);await manage(B,{action:'trial',planId:standard})
  let s=(await current(adminB)).subscription
  expect(s).toMatchObject({effectiveStatus:'Trial',planId:standard});expect(Math.round((Date.parse(s.endsAt)-Date.now())/day)).toBe(14)
  await manage(B,{action:'extend',days:10});s=(await current(adminB)).subscription;expect(Math.round((Date.parse(s.endsAt)-Date.now())/day)).toBe(24)
  // Expiry moves to a grace period and then to Expired; neither blocks the school nor removes anything.
  psql(`UPDATE billing.subscriptions SET ends_at=now()-interval '2 days' WHERE school_id='${B}'`)
  expect((await current(adminB)).subscription.effectiveStatus).toBe('Grace Period')
  await denied(platform,'PUT','/billing/settings',{graceDays:91},400);await ok(platform,'PUT','/billing/settings',{graceDays:1})
  expect((await current(adminB)).subscription.effectiveStatus).toBe('Expired')
  expect((await ok(platform,'GET','/billing/overview')).expired).toBeGreaterThanOrEqual(1)
  adminB=await login('billing-b-'+tag);await ok(adminB,'GET','/students');await ok(adminB,'GET','/control/configuration')
  await ok(platform,'PUT','/billing/settings',{graceDays:7})
  await manage(B,{action:'cancel'});expect((await current(adminB)).subscription.effectiveStatus).toBe('Cancelled')
  await manage(B,{action:'cancel'},400);await manage(B,{action:'restore'});await manage(B,{action:'restore'},400)
  expect((await current(adminB)).subscription.effectiveStatus).toBe('Grace Period')
  await manage(B,{action:'extend',days:30});s=(await current(adminB)).subscription
  expect(s.effectiveStatus).toBe('Trial');expect(Math.round((Date.parse(s.endsAt)-Date.now())/day)).toBe(30)
  await manage(B,{action:'activate',planId:standard})
  expect((await current(adminB)).subscription).toMatchObject({effectiveStatus:'Active',planId:standard,basePrice:3000000,finalAmount:3000000,paymentState:'NotRequired'})
  await manage(B,{action:'change-plan',planId:pro});expect((await current(adminB)).subscription.planId).toBe(pro)
  await manage(B,{action:'delete'},400);await manage(randomUUID(),{action:'complimentary'},404);await manage(platformId,{action:'complimentary'},404)
  expect(await history(B)).toEqual(expect.arrayContaining(['billing.subscription.complimentary','billing.subscription.trial','billing.trial.extended','billing.subscription.cancelled','billing.subscription.restored','billing.subscription.activated','billing.subscription.plan_changed']))
 })

 test('online payment stays off until the provider is configured',async()=>{
  test.skip(payments,'The stack has test payment keys; the paid flow is covered below.')
  expect((await current(adminA)).paymentsEnabled).toBe(false)
  await denied(adminA,'POST','/subscription/checkout',{planId:standard},503)
  expect((await current(adminA)).subscription.effectiveStatus).toBe('None')
 })

 test('the order amount is calculated by the server, never by the client',async()=>{
  test.skip(!payments,'Start the stack with the test RAZORPAY_* variables to run the payment flow.')
  order1=await ok(adminA,'POST','/subscription/checkout',{planId:standard,coupon:code('qa25'),amount:1,finalAmount:1,basePrice:1,discount:2499999,currency:'USD'})
  expect(order1).toMatchObject({amount:1875000,currency:'INR'});expect(order1).not.toHaveProperty('keySecret')
  const sent=orders.at(-1)!
  expect(sent.body).toMatchObject({amount:1875000,currency:'INR'});expect(sent.body.receipt).toMatch(/^eduos_[0-9a-f]{32}$/);expect(sent.authorization).toMatch(/^Basic /)
  const view=await current(adminA)
  expect(view.subscription.effectiveStatus).toBe('None');expect(view.payments[0]).toMatchObject({providerOrderId:order1.orderId,amount:1875000,discount:625000,status:'Created'})
  await denied(adminA,'POST','/subscription/checkout',{planId:disabled},404);await denied(adminA,'POST','/subscription/checkout',{planId:standard,coupon:code('qaold')},400)
 })

 test('a subscription is activated only after the payment signature is verified',async()=>{
  test.skip(!payments,'Start the stack with the test RAZORPAY_* variables to run the payment flow.')
  const paymentId='pay_'+tag+'1',verify=(who:any,signature:string,orderId=order1.orderId)=>call(who,'POST','/subscription/verify',{orderId,paymentId,signature})
  expect((await verify(adminA,'0'.repeat(64))).status()).toBe(400)
  expect((await verify(adminA,sign('order_other|'+paymentId,keySecret))).status()).toBe(400)
  expect((await verify(adminA,sign(order1.orderId+'|'+paymentId,hookSecret))).status()).toBe(400)
  expect((await verify(adminB,sign(order1.orderId+'|'+paymentId,keySecret))).status()).toBe(404)
  expect((await current(adminA)).subscription.effectiveStatus).toBe('None')
  const first=await verify(adminA,sign(order1.orderId+'|'+paymentId,keySecret));expect(first.status(),await first.text()).toBe(200)
  expect((await first.json()).data).toEqual({status:'Paid',alreadyProcessed:false})
  const view=await current(adminA),s=view.subscription
  expect(s).toMatchObject({effectiveStatus:'Active',planId:standard,basePrice:2500000,discount:625000,finalAmount:1875000,paymentState:'Paid'})
  expect(Math.round((Date.parse(s.endsAt)-Date.now())/day)).toBeGreaterThanOrEqual(365)
  expect(view.payments[0]).toMatchObject({status:'Paid',providerPaymentId:paymentId})
  expect((await (await verify(adminA,sign(order1.orderId+'|'+paymentId,keySecret))).json()).data.alreadyProcessed).toBe(true)
  expect((await current(adminA)).subscription.endsAt).toBe(s.endsAt)
  expect((await ok(platform,'GET','/billing/offers')).find((o:any)=>o.id===coupon25).used).toBe(1)
  expect(await history(A)).toEqual(expect.arrayContaining(['billing.payment.created','billing.payment.verification_failed','billing.payment.verified','billing.subscription.activated']))
 })

 test('webhooks are signature-checked and applied exactly once',async()=>{
  test.skip(!payments,'Start the stack with the test RAZORPAY_* variables to run the payment flow.')
  const before=(await current(adminA)).subscription.endsAt,paymentId='pay_'+tag+'2',eventId=randomUUID()
  order2=await ok(adminA,'POST','/subscription/checkout',{planId:standard});expect(order2.amount).toBe(2500000)
  expect((await webhook('payment.captured',order2.orderId,paymentId,2500000,{signature:'0'.repeat(64)})).status).toBe(400)
  expect((await webhook('payment.captured',order2.orderId,paymentId,2500000,{signature:''})).status).toBe(400)
  expect((await webhook('payment.captured',order2.orderId,paymentId,2500000,{signature:sign('{}',hookSecret)})).status).toBe(400)
  expect((await webhook('payment.captured',order2.orderId,paymentId,1)).body.status).toBe('mismatch')
  expect((await webhook('payment.captured','order_unknown'+tag,paymentId,2500000)).body.status).toBe('ignored')
  expect((await webhook('refund.created',order2.orderId,paymentId,2500000)).body.status).toBe('ignored')
  expect((await current(adminA)).subscription.endsAt).toBe(before)
  expect((await webhook('payment.captured',order2.orderId,paymentId,2500000,{eventId})).body.status).toBe('processed')
  // A renewal of the running plan starts when the paid period ends.
  const renewed=(await current(adminA)).subscription.endsAt
  expect(Math.round((Date.parse(renewed)-Date.parse(before))/day)).toBeGreaterThanOrEqual(365)
  expect((await webhook('payment.captured',order2.orderId,paymentId,2500000,{eventId})).body.status).toBe('duplicate')
  expect((await webhook('order.paid',order2.orderId,paymentId,2500000)).body.status).toBe('processed')
  expect((await ok(adminA,'POST','/subscription/verify',{orderId:order2.orderId,paymentId,signature:sign(order2.orderId+'|'+paymentId,keySecret)})).alreadyProcessed).toBe(true)
  const view=await current(adminA)
  expect(view.subscription.endsAt).toBe(renewed);expect(view.payments.filter((p:any)=>p.status==='Paid')).toHaveLength(2)
  // A failed payment is shown, changes nothing and can be retried; a dismissed checkout is cancelled.
  const failed=await ok(adminA,'POST','/subscription/checkout',{planId:standard})
  expect((await webhook('payment.failed',failed.orderId,'pay_'+tag+'3',2500000,{error:'Card declined by bank'})).body.status).toBe('processed')
  const retry=await ok(adminA,'POST','/subscription/checkout',{planId:standard})
  expect((await ok(adminB,'POST','/subscription/payments/'+retry.paymentId+'/cancel')).cancelled).toBe(false)
  expect((await ok(adminA,'POST','/subscription/payments/'+retry.paymentId+'/cancel')).cancelled).toBe(true)
  const after=await current(adminA)
  expect(after.subscription.endsAt).toBe(renewed)
  expect(after.payments.find((p:any)=>p.providerOrderId===failed.orderId)).toMatchObject({status:'Failed',failureReason:'Card declined by bank'})
  expect(after.payments.find((p:any)=>p.providerOrderId===retry.orderId).status).toBe('Cancelled')
  const all=await ok(platform,'GET','/billing/payments?school='+A)
  expect(all).toHaveLength(4);expect(all.every((p:any)=>p.schoolId===A&&!('cardNumber' in p))).toBe(true)
  expect((await ok(platform,'GET','/billing/overview')).revenue.find((r:any)=>r.currency==='INR').total).toBeGreaterThanOrEqual(4375000)
  expect(await history(A)).toEqual(expect.arrayContaining(['billing.payment.amount_mismatch','billing.payment.failed','billing.payment.cancelled']))
 })

 test('promotions appear only where and when the platform configures them',async({page})=>{
  const banner=(body:Record<string,unknown>,status=201)=>ok(platform,'POST','/billing/banners',{title:'QA sale '+tag,message:'25% off annual plans',placement:'login',enabled:true,startsAt:at(-1),endsAt:at(1),...body},status)
  const shown=async(placement:string)=>(await ok(null,'GET','/promotions?placement='+placement)).map((b:any)=>b.title)
  const live=(await banner({ctaLabel:'View plans',ctaUrl:'/subscription'})).id
  await banner({title:'QA later '+tag,startsAt:at(2),endsAt:at(5)});await banner({title:'QA over '+tag,startsAt:at(-5),endsAt:at(-2)});await banner({title:'QA hidden '+tag,enabled:false})
  for(const ctaUrl of ['https://evil.example','//evil.example','javascript:alert(1)'])await banner({ctaLabel:'Go',ctaUrl},400)
  await banner({placement:'student-dashboard'},400);await banner({endsAt:at(-3)},400);await denied(adminA,'POST','/billing/banners',{title:'Mine'})
  expect(await shown('login')).toEqual(['QA sale '+tag]);expect(await shown('subscription')).not.toContain('QA sale '+tag);expect(await shown('student')).toEqual([])
  await page.goto('/login');await expect(page.getByText('QA sale '+tag,{exact:true})).toBeVisible()
  await ok(platform,'PUT','/billing/banners/'+live,{title:'QA sale '+tag,placement:'login',enabled:false,startsAt:at(-1),endsAt:at(1)})
  expect(await shown('login')).toEqual([]);await page.reload();await expect(page.getByRole('heading',{name:'Good to see you.'})).toBeVisible();await expect(page.getByText('QA sale '+tag)).toHaveCount(0)
 })

 test('billing pages are shown to the right people',async({browser})=>{
  const open=async(who:any,url:string)=>{const context=await browser.newContext();const page=await context.newPage();await page.addInitScript(session(who),who);await page.goto(url);return page}
  const owner=await open(platform,'/super-admin/billing/plans')
  await expect(owner.getByRole('heading',{name:'Billing & subscriptions'})).toBeVisible();await expect(owner.getByText('QA Standard '+tag,{exact:true})).toBeVisible()
  await owner.getByRole('link',{name:'Subscriptions',exact:true}).click();await expect(owner.getByRole('button',{name:'Manage Billing QA '+tag,exact:true})).toBeVisible()
  await owner.getByRole('link',{name:'Overview',exact:true}).click();await expect(owner.getByText('Active subscriptions')).toBeVisible()
  adminA=await login('billing-a-'+tag)
  const school=await open(adminA,'/subscription')
  await expect(school.getByRole('heading',{name:'Subscription & billing'})).toBeVisible();await expect(school.getByRole('heading',{name:'QA Standard '+tag})).toBeVisible()
  await expect(school.getByRole('link',{name:'Subscription & billing'})).toBeVisible()
  await school.setViewportSize({width:390,height:844});expect(await school.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  await school.goto('/super-admin/billing');await expect(school.getByRole('heading',{name:'Billing & subscriptions'})).toHaveCount(0)
  const family=await open(parent,'/subscription')
  await expect(family.getByRole('heading',{name:'This area isn’t available for your role'})).toBeVisible();await expect(family.getByRole('link',{name:'Subscription & billing'})).toHaveCount(0)
 })
})
