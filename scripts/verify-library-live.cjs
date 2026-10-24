const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process');const base='http://localhost:8081/api/v1';
async function call(path,t,body,method=body?'POST':'GET',status=200){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();assert.equal(r.status,status,path+': '+text.slice(0,250));return text?JSON.parse(text).data:null;}
const sql=q=>execFileSync('docker',['exec','-i','eduos-postgres-1','sh','-c','exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At'],{input:q,encoding:'utf8'}).trim();
(async()=>{const login=async name=>call('/auth/login',null,{username:name+'@demo.eduos.local',password:process.env.EDUOS_DEMO_TEST_PASSWORD});const [admin,teacher]=await Promise.all(['admin','teacher'].map(login)),t=admin.accessToken,school=admin.user.schoolId;assert.match(school,/^[a-f0-9-]{36}$/i);const options=await call('/suite/options',t);assert(options.students.length>=2);let book;const tag=randomUUID().slice(0,8),date='2026-10-23';
const payload={title:'QA library '+tag,code:'QA-'+tag,author:'QA Author',copies:1,status:'Available'};
try{
await call('/suite/records/library-books',t,{...payload,copies:1.5},'POST',400);
book=(await call('/suite/records/library-books',t,payload,'POST',201)).id;assert.match(book,/^[a-f0-9-]{36}$/i);
await call('/suite/records/library-books',t,payload,'POST',409);
const loan={bookId:book,studentId:options.students[0].id,issuedOn:date,dueOn:date,status:'Issued'};
const created=await call('/suite/records/library-loans',t,loan,'POST',201),id=created.id;
await call('/suite/records/library-loans',t,{...loan,studentId:options.students[1].id},'POST',409);
const read=async(kind,id)=>(await call('/suite/records/'+kind+'?search='+encodeURIComponent(kind==='library-books'?tag:''),t)).data.find(r=>r.id===id);
const stock=await read('library-books',book);await call('/suite/records/library-books/'+book,t,{...stock,status:'Retired'},'PUT',409);
let row=await read('library-loans',id);assert.equal(row.status,'Issued');await call('/suite/records/library-loans/'+id,t,{...row,status:'Returned',returnedOn:date},'PUT');row=await read('library-loans',id);assert.equal(row.status,'Returned');
await call('/suite/records/library-loans/'+id,t,{...row,status:'Issued',returnedOn:''},'PUT',409);
await call('/suite/records/library-loans',t,{...loan,dueOn:'2000-01-01'},'POST',400);
await call('/suite/records/library-books',teacher.accessToken,payload,'POST',403);
await call('/suite/records/library-loans',t,{...loan,studentId:options.students[1].id},'POST',201);
console.log('Library passed: stock/code validation, checkout/reload, capacity, retirement protection, return/reload, reopening blocked, dates, reissue and teacher write denial.');
}finally{if(book){sql(`BEGIN;DELETE FROM suite.records WHERE school_id='${school}' AND kind='library-loans' AND data->>'bookId'='${book}';DELETE FROM suite.records WHERE school_id='${school}' AND kind='library-books' AND id='${book}';COMMIT;`);assert.equal(sql(`SELECT count(*) FROM suite.records WHERE school_id='${school}' AND (id='${book}' OR data->>'bookId'='${book}');`),'0');console.log('Temporary book and loans removed; audit retained.');}}
})().catch(e=>{console.error(e.message);process.exitCode=1});
