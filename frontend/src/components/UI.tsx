import { ReactNode, useEffect, useRef } from 'react'
import { AlertCircle, Inbox, X, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
export function PageHeader({eyebrow,title,description,children}:{eyebrow?:string,title:string,description:string,children?:ReactNode}){
 return <div className="page-heading"><div><div className="eyebrow">{eyebrow || 'SCHOOL WORKSPACE'}</div><h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{children}</div></div>
}
export function ErrorBox({message}:{message:string}){return <div className="error-box" role="alert"><AlertCircle size={18}/><span>{message}</span></div>}
export function Loading(){return <div className="empty-state" role="status"><Loader2 className="spin" size={26}/><p>Loading your workspace…</p></div>}
export function Empty({title,description}:{title:string,description:string}){return <div className="empty-state"><span className="empty-icon"><Inbox size={27}/></span><h3>{title}</h3><p>{description}</p></div>}
export function Dialog({title,onClose,children}:{title:string,onClose:()=>void,children:ReactNode}){
 const ref=useRef<HTMLDialogElement>(null)
 useEffect(()=>{ref.current?.showModal();return()=>ref.current?.close()},[])
 return <dialog ref={ref} className="modal" onCancel={e=>{e.preventDefault();onClose()}} aria-label={title}><div className="modal-header"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div>{children}</dialog>
}
export function Pagination({page,total,size=20,onChange}:{page:number,total:number,size?:number,onChange:(n:number)=>void}){
 const pages=Math.max(1,Math.ceil(total/size))
 return <div className="pagination"><span>{total===0?'No records':((page-1)*size+1)+'–'+Math.min(page*size,total)+' of '+total+' records'}</span><div><button className="icon-button" aria-label="Previous page" disabled={page<=1} onClick={()=>onChange(page-1)}><ChevronLeft size={18}/></button><span>Page {page} of {pages}</span><button className="icon-button" aria-label="Next page" disabled={page>=pages} onClick={()=>onChange(page+1)}><ChevronRight size={18}/></button></div></div>
}
export function exportCsv(name:string,rows:Record<string,unknown>[],columns:[string,string][]){
 const escape=(value:unknown)=>{let s=String(value??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'}
 const csv=[columns.map(([label])=>escape(label)).join(','),...rows.map(row=>columns.map(([,key])=>escape(row[key])).join(','))].join('\r\n')
 const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'}))
 const a=document.createElement('a');a.href=url;a.download=name+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export function today(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
