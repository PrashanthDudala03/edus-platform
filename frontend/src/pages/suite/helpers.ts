import client from '../../api/client'
export type Row=Record<string,any>
export type Field={key:string,label:string,type:string,required:boolean,source?:string,options?:string[]}
export type Module={kind:string,title:string,group:string,fields:Field[],canWrite:boolean}
export type Option={id:string,label:string}
export type Options=Record<string,Option[]>
export async function data<T=any>(path:string,params?:Row):Promise<T>{return(await client.get('/suite'+path,{params})).data.data}
export function label(options:Options|undefined,source:string|undefined,value:unknown){return source?options?.[source]?.find(o=>o.id===value)?.label||String(value||'—'):String(value??'—')}
export async function workbook(name:string,rows:Row[],columns?:{key:string,label:string}[]){
 const {default:writeExcelFile}=await import('write-excel-file/browser')
 const fields=columns||Object.keys(rows[0]||{}).filter(k=>!['version','schoolId'].includes(k)).map(key=>({key,label:key}))
 const sheet=[fields.map(f=>({value:f.label,type:String,fontWeight:'bold' as const})),...rows.map(row=>fields.map(f=>typeof row[f.key]==='number'?{value:row[f.key],type:Number}:{value:String(row[f.key]??''),type:String}))]
 await writeExcelFile(sheet).toFile(name+'.xlsx')
}
const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
export function printSchoolDocument(kind:string,result:Row){
 const popup=window.open('','_blank','width=900,height=750')
 if(!popup)throw new Error('Allow pop-ups to open the printable document.')
 const school=result.school||{},student=result.student||{},receipt=result.receipt||{},cert=result.certificate||{}
 let title='',body=''
 const line=(k:string,v:unknown)=>'<div class="line"><strong>'+escape(k)+'</strong><span>'+escape(v)+'</span></div>'
 if(kind==='receipt'){
  title='Payment receipt'
  // The school's own receipt: who paid what for which fee, how, when, who received it, and whether it still stands.
  body=(receipt.status==='Reversed'?'<p class="reversed">REVERSED'+(receipt.reversedAt?' on '+String(receipt.reversedAt).slice(0,10):'')+(receipt.reversalReason?' · '+escape(receipt.reversalReason):'')+'</p>':'')
   +line('Receipt number',receipt.receipt)+line('Student',receipt.student)+line('Admission number',receipt.admissionNumber)+(receipt.class?line('Class',receipt.class):'')+(receipt.academicYear?line('Academic year',receipt.academicYear):'')
   +line('Fee / instalment',(receipt.feeHead?receipt.feeHead+' · ':'')+receipt.description)+line('Payment date',String(receipt.paidOn).slice(0,10))+line('Amount received',receipt.currency+' '+Number(receipt.amount).toFixed(2))+line('Method',receipt.method)+line('Transaction / reference',receipt.reference||(receipt.method==='Cash'?'Cash payment':'—'))
   +(receipt.collectedBy?line('Received by',receipt.collectedBy):'')+line('Status',receipt.status||'Completed')+(receipt.note?line('Note',receipt.note):'')
   +'<p class="note">'+(receipt.source==='online'?'This receipt records a payment verified by the school’s payment provider and settled to the school.':'This receipt records a payment received by the school. No online payment was collected by this application.')+'</p>'
 }else if(kind==='report'){
  title='Student report card'
  // Scheme-aware: each result shows its components (Theory 56/70 · Practical 25/30) when the exam has them, the grade
  // the scheme gives, and Absent or Exempt instead of marks. Totals appear only where marks make them meaningful.
  const marks=(r:Row)=>r.status==='Absent'?'Absent':r.status==='Exempt'?'Exempt':r.maximum==null?'—':r.score+' / '+r.maximum
  const parts=(r:Row)=>Array.isArray(r.components)&&r.components.length>1?r.components.map((c:Row)=>c.name+' '+(c.score??'—')+'/'+c.max).join(' · '):''
  const att=result.attendance
  body=line('Student',student.name)+line('Admission number',student.admissionNumber)+line('Class',student.class)+(result.year?line('Academic year',result.year+(result.term?' · '+result.term:'')):'')
   +'<table><thead><tr><th>Exam</th><th>Subject</th><th>Marks</th><th>Components</th><th>Grade</th><th>Result</th><th>Remarks</th></tr></thead><tbody>'+result.results.map((r:Row)=>'<tr>'+[r.exam+(r.term?' · '+r.term:''),r.subject,marks(r),parts(r),r.grade,r.status==='Exempt'?'Exempt':r.pass?'Pass':'Below pass marks',r.remarks].map(v=>'<td>'+escape(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table>'
   +(result.maximum?line('Total',result.obtained+' / '+result.maximum)+line('Percentage',result.percent+'%'):'')+line('Grade',result.grade)+line('Subjects passed',result.passed+(result.failed?' · '+result.failed+' below pass marks':''))
   +(att?line('Attendance '+String(att.from).slice(0,10)+' to '+String(att.to).slice(0,10),(att.percent==null?'—':att.percent+'%')+' · '+att.present+' present, '+att.late+' late, '+att.absent+' absent, '+att.excused+' excused of '+att.markedDays+' days'):'')
   +'<p class="note">'+escape(result.note)+'</p>'
  if(result.signatures?.principal)school.principal=result.signatures.principal
  body+='<div class="signature"><span>Class teacher'+(result.signatures?.classTeacher?': '+escape(result.signatures.classTeacher):'')+'</span><span>Parent / guardian</span></div>'
 }else{
  title=cert.type||'Certificate'
  body=line('Document number',cert.certificateNumber)+line('Issued on',cert.issuedOn)
  if(cert.type==='Student ID')body+='<div class="id-card"><div class="id-brand">'+escape(school.name)+'</div><h2>'+escape(student.name)+'</h2><p>'+escape(student.admissionNumber)+'</p><p>'+escape(student.class)+'</p><small>Student identification</small></div>'
  else body+='<p class="certificate-text">This is to certify that <strong>'+escape(student.name)+'</strong>, admission number <strong>'+escape(student.admissionNumber)+'</strong>, is recorded in <strong>'+escape(student.class)+'</strong> at '+escape(school.name)+'.</p>'+line('Date of birth',String(student.dateOfBirth).slice(0,10))+'<p>'+escape(cert.remarks)+'</p>'
 }
 popup.document.write('<!doctype html><html><head><meta charset="utf-8"><title>'+escape(title)+'</title><style>body{font:14px Arial,sans-serif;color:#223a32;max-width:850px;margin:35px auto;padding:25px}header{text-align:center;border-bottom:3px solid #167865;padding-bottom:20px}h1{font-size:27px}h2{font-size:22px}.line{display:flex;justify-content:space-between;border-bottom:1px solid #e4e9e6;padding:12px 0;gap:30px}.line span{text-align:right}table{width:100%;border-collapse:collapse;margin:25px 0}th,td{border:1px solid #d9e2dd;padding:9px;text-align:left}th{background:#edf5ef}.note,footer{font-size:11px;color:#60766a;line-height:1.7;margin-top:30px}.certificate-text{font-size:19px;line-height:2;margin:40px 0}.signature{margin-top:65px;display:flex;justify-content:space-between}.id-card{border:2px solid #167865;border-radius:12px;width:310px;padding:25px;text-align:center;margin:30px auto}.id-brand{background:#167865;color:white;padding:15px;margin:-25px -25px 25px}.print-help{background:#eef5ed;padding:12px;color:#52734d}.reversed{color:#9b2c2c;font-weight:700;letter-spacing:1px;border:2px solid #9b2c2c;padding:8px;text-align:center}@media print{.print-help{display:none}body{margin:0;padding:16mm}thead{display:table-header-group}tr{break-inside:avoid}}</style></head><body><div class="print-help">Use your browser’s Print command (Ctrl+P) to print or save as PDF.</div><header><h1>'+escape(school.name)+'</h1><p>'+escape(school.address)+'</p><small>'+escape(school.phone)+' '+escape(school.website)+'</small></header><h2>'+escape(title)+'</h2>'+body+'<div class="signature"><span>Authorized school representative</span><span>'+escape(school.principal)+'</span></div><footer>'+escape(school.printFooter||'Generated from school records. Verify and sign before official issue.')+'</footer></body></html>')
 popup.document.close();popup.focus()
}
