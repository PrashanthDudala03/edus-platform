/** Convert a school wall-clock time to one unambiguous UTC instant. Reject DST gaps and repeats. */
export function schoolLocal(iso:string,zone:string):string {
 const date=new Date(iso);if(!iso||Number.isNaN(date.getTime()))return ''
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date)
 const part=(name:string)=>parts.find(p=>p.type===name)?.value
 return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`
}
export function schoolInstant(local:string,zone:string):string {
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))return ''
 const wall=Date.parse(local+'Z');if(Number.isNaN(wall))return ''
 const offsets=new Set<number>()
 for(const delta of [-86400000,0,86400000]){const at=wall+delta;offsets.add(Date.parse(schoolLocal(new Date(at).toISOString(),zone)+'Z')-at)}
 const matches=[...offsets].map(offset=>new Date(wall-offset).toISOString()).filter(iso=>schoolLocal(iso,zone)===local)
 return matches.length===1?matches[0]:''
}
