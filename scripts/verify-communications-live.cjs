const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const base='http://localhost:8081/api/v1';
async function call(path,token,body,method=body?'POST':'GET',expected=200){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();assert.equal(r.status,expected,method+' '+path+': '+text.slice(0,300));const j=text?JSON.parse(text):{};return j.data;}
const sql=q=>execFileSync('docker',['exec','-i','eduos-postgres-1','sh','-c','exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At'],{input:q,encoding:'utf8'}).trim();
(async()=>{
 const login=async name=>call('/auth/login',null,{username:name+'@demo.eduos.local',password:process.env.EDUOS_DEMO_TEST_PASSWORD});
 const [admin,teacher,parent]=await Promise.all(['admin','teacher','parent'].map(login));const a=admin.accessToken,school=admin.user.schoolId;assert.match(school,/^[a-f0-9-]{36}$/i);
 const options=await call('/suite/options',a),classId=options.classes[0].id;
 const draft={title:'QA notice '+randomUUID(),message:'Temporary unpublished audit draft',type:'Notice',priority:'Normal',audience:'Parent',classId,requiresAcknowledgement:'No',status:'Draft'};let id;
 try{
 const preview=await call('/suite/communications/audience',a,{audience:'Parent',classId});assert.equal(typeof preview.count,'number');assert(!('people' in preview));
 const created=await call('/suite/records/circulars',a,draft,'POST',201);id=created.id;assert.match(id,/^[a-f0-9-]{36}$/i);
 const record=(await call('/suite/records/circulars?search='+encodeURIComponent(draft.title),a)).data.find(r=>r.id===id);assert.equal(record.status,'Draft');
 await call('/suite/records/circulars/'+id,a,{...draft,message:'Updated unpublished draft',version:record.version},'PUT');
 const saved=(await call('/suite/records/circulars?search='+encodeURIComponent(draft.title),a)).data.find(r=>r.id===id);assert.equal(saved.message,'Updated unpublished draft');
 const feed=await call('/suite/communications/feed',parent.accessToken);assert(!JSON.stringify(feed).includes(id));
 await call('/suite/communications/'+id,parent.accessToken,undefined,'GET',403);
 await call('/suite/communications/audience',parent.accessToken,{audience:'All'},'POST',403);
 await call('/suite/communications/audience',teacher.accessToken,{audience:'All',classId:''},'POST',403);
 console.log('Live API passed: audience count, draft create/edit/reload, parent draft denial and teacher school-wide audience denial.');
 }finally{if(id){sql(`DELETE FROM suite.records WHERE school_id='${school}' AND id='${id}' AND kind='circulars';`);assert.equal(sql(`SELECT count(*) FROM suite.records WHERE school_id='${school}' AND id='${id}';`),'0');console.log('Temporary draft removed; audit retained. No notice published or sent.');}}
})().catch(e=>{console.error(e.message);process.exitCode=1});
