import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Printer, FileDown, Upload, Send } from 'lucide-react'
import Papa from 'papaparse'
import client,{errorMessage} from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { Dialog, Empty, ErrorBox, Loading, PageHeader, today } from '../../components/UI'
import {data,Options,Row,workbook,printSchoolDocument} from './helpers'
import { ClassAttendanceReport } from './AttendancePages'
import { isAdministrator as isAdmin, isLeadership } from '../../roles'
export function AllocationPage(){
 const cache=useQueryClient(),[selected,setSelected]=useState<string[]>([]),[classId,setClass]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
 const options=useQuery<Options>({queryKey:['suite','options'],queryFn:()=>data('/options')}),allocated=useQuery<Row[]>({queryKey:['suite','allocations'],queryFn:()=>data('/allocations')})
 async function submit(){if(!window.confirm('Allocate or promote '+selected.length+' selected students to this class? Their previous class will be replaced.'))return;setBusy(true);setError('');try{await client.post('/suite/allocate',{studentIds:selected,classId});setMessage('Class allocation updated for '+selected.length+' students.');setSelected([]);await cache.invalidateQueries()}catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
 return <><PageHeader eyebrow="ACADEMIC SETUP" title="Class allocation & promotion" description="Assign existing or imported students to a class, or promote them into the next academic year."/>
 {error&&<ErrorBox message={error}/>} {message&&<div className="success-box">{message}</div>}
 <section className="panel"><div className="attendance-toolbar"><label>Destination class<select value={classId} onChange={e=>setClass(e.target.value)}><option value="">Select class and section</option>{options.data?.classes?.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label><button className="button primary" disabled={!selected.length||!classId||busy} onClick={submit}>Allocate {selected.length} students</button></div>
 {options.isPending?<Loading/>:options.isError?<ErrorBox message={errorMessage(options.error)}/>:<div className="table-scroll"><table><thead><tr><th>Select</th><th>Student</th><th>Current allocated class</th></tr></thead><tbody>{options.data?.students.map(s=><tr key={s.id}><td><input className="table-checkbox" type="checkbox" aria-label={'Select '+s.label} checked={selected.includes(s.id)} onChange={e=>setSelected(e.target.checked?[...selected,s.id]:selected.filter(id=>id!==s.id))}/></td><td>{s.label}</td><td>{allocated.data?.find(a=>a.studentId===s.id)?.class||'Not allocated'}</td></tr>)}</tbody></table></div>}</section></>
}
export function ReportsPage(){
 const role=useAuthStore(s=>s.user?.roles[0]),admin=isLeadership(role)
 const [type,setType]=useState('attendance'),[month,setMonth]=useState(today().slice(0,7)),[student,setStudent]=useState(''),[term,setTerm]=useState(''),[error,setError]=useState('')
 const options=useQuery<Options>({queryKey:['suite','options'],queryFn:()=>data('/options')})
 const rows=useQuery<Row[]>({queryKey:['suite','reports',type,month],enabled:type!=='attendance-classes',queryFn:()=>data(type==='fees'?'/fees':'/reports/'+type,{month})})
 async function report(){try{const r=await data('/report-cards/'+student,{examName:term||undefined});if(!r.results.length)throw new Error('There are no published results for this selection.');printSchoolDocument('report',r)}catch(e){setError(errorMessage(e))}}
 const fields=Object.keys(rows.data?.[0]||{}).filter(k=>!['id','studentId','teacherId','version','createdAt'].includes(k))
 return <><PageHeader eyebrow="REPORTS & EXCEL TOOLS" title="School reports" description="Export the records you are authorized to view, or prepare a printable student report card."/>
 {error&&<ErrorBox message={error}/>}<section className="panel"><div className="attendance-toolbar"><label>Report<select value={type} onChange={e=>setType(e.target.value)}><option value="attendance">Monthly student attendance</option>{(admin||role==='Teacher')&&<option value="attendance-classes">Monthly attendance by class</option>}{(admin||role==='Teacher')&&<option value="staff-attendance">Monthly staff attendance</option>}<option value="marks">Marks</option>{admin&&<option value="admissions">Admissions</option>}{role!=='Teacher'&&<option value="fees">Fee balances</option>}{admin&&<option value="audit">Attributed activity (latest 100)</option>}</select></label>{type.includes('attendance')&&<label>Month<input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label>}<button className="button secondary" disabled={!rows.data?.length} onClick={()=>workbook(type+'-'+month,rows.data!)}><FileDown size={16}/>Download Excel</button></div>
 {type==='attendance-classes'?<ClassAttendanceReport month={month}/>:rows.isPending?<Loading/>:rows.isError?<ErrorBox message={errorMessage(rows.error)}/>:!rows.data.length?<Empty title="No records for this report" description="Saved school data will appear here when available."/>:<div className="table-scroll"><table><thead><tr>{fields.map(f=><th key={f}>{f.replace(/([A-Z])/g,' $1')}</th>)}</tr></thead><tbody>{rows.data.map((r,i)=><tr key={i}>{fields.map(f=><td key={f} className="truncate-cell">{String(r[f]??'—')}</td>)}</tr>)}</tbody></table></div>}</section>
 <section className="panel suite-section"><div className="panel-heading"><div><h2>Downloadable report card</h2><p>Only published exams with saved marks are included. Print or choose Save as PDF in your browser.</p></div></div><div className="attendance-toolbar"><label>Student<select value={student} onChange={e=>setStudent(e.target.value)}><option value="">Select student</option>{options.data?.students.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label><label>Exam / term name (optional)<input value={term} onChange={e=>setTerm(e.target.value)} placeholder="All published exams"/></label><button className="button primary" disabled={!student} onClick={report}><Printer size={16}/>Open report card</button></div></section>
 {isAdmin(role)&&<ImportPanel/>}</>
}
function ImportPanel(){
 const cache=useQueryClient(),[kind,setKind]=useState('students'),[rows,setRows]=useState<Row[]>([]),[result,setResult]=useState<Row|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const columns=kind==='students'?['rollNumber','firstName','lastName','email','phoneNumber','dateOfBirth','currentClass']:['employeeCode','firstName','lastName','email','phoneNumber','department']
 async function file(file:File){
  setError('');setResult(null);setRows([]);if(file.size>2*1024*1024){setError('Use a workbook smaller than 2 MB, with at most 500 rows.');return}setBusy(true)
  try{let parsed:Row[]=[]
   if(file.name.toLowerCase().endsWith('.csv')){const r=Papa.parse<Row>(await file.text(),{header:true,skipEmptyLines:true});if(r.errors.length)throw new Error('The CSV contains malformed rows.');parsed=r.data}
   else if(file.name.toLowerCase().endsWith('.xlsx')){const {readSheet}=await import('read-excel-file/universal');const sheet=await readSheet(await file.arrayBuffer());if(sheet.length>501)throw new Error('Maximum 500 data rows.');const headers=(sheet[0]||[]).map(v=>String(v??'').trim());if(new Set(headers).size!==headers.length)throw new Error('Column names must be unique.');parsed=sheet.slice(1).filter(row=>row.some(v=>v!==null)).map(row=>Object.fromEntries(headers.map((key,i)=>[key,row[i] instanceof Date?row[i].toISOString().slice(0,10):String(row[i]??'')])))}
   else throw new Error('Select an .xlsx or .csv file.')
   if(!parsed.length||parsed.length>500)throw new Error('Import between 1 and 500 data rows.')
   setRows(parsed);const r=await client.post('/suite/imports/'+kind,{rows:parsed,commit:false});setResult(r.data.data)
  }catch(e){setError(errorMessage(e))}finally{setBusy(false)}
 }
 async function commit(){if(!window.confirm('Import '+rows.length+' '+kind+'? All rows will be saved together, or none if a conflict occurs.'))return;setBusy(true);setError('');try{const r=await client.post('/suite/imports/'+kind,{rows,commit:true});setResult(r.data.data);await cache.invalidateQueries()}catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
 return <section className="panel suite-section"><div className="panel-heading"><div><h2>Import student or staff records</h2><p>Download the Excel template, enter values, upload, review validation, then confirm the import. Existing record numbers are never overwritten.</p></div></div><div className="attendance-toolbar"><label>Record type<select value={kind} onChange={e=>{setKind(e.target.value);setResult(null);setRows([])}}><option value="students">Students</option><option value="teachers">Teaching staff</option></select></label><button className="button secondary" onClick={()=>workbook(kind+'-import-template',[],columns.map(key=>({key,label:key})))}><FileDown size={16}/>Excel template</button><label className="upload-button"><Upload size={16}/>{busy?'Checking…':'Choose workbook'}<input type="file" accept=".xlsx,.csv" disabled={busy} onChange={e=>{if(e.target.files?.[0])file(e.target.files[0]);e.target.value=''}}/></label></div>
 {error&&<ErrorBox message={error}/>} {result&&<div className="import-result">{result.errors?.length?<ErrorBox message={result.errors.slice(0,20).join(' ')}/>:<div className="success-box">{result.committed?result.count+' records imported.':result.count+' rows passed field validation. Existing-record conflicts are checked during commit.'}</div>}{result.valid&&!result.committed&&<button className="button primary" disabled={busy} onClick={commit}>Confirm import of {rows.length} records</button>}</div>}</section>
}
