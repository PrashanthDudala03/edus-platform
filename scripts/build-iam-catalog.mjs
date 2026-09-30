// Generates the initial catalogue from implemented suite modules. Runtime grants live in PostgreSQL.
import fs from 'node:fs'
const schemas=JSON.parse(fs.readFileSync('services/school-service/SuiteSchemas.json','utf8'))
const entries=new Map()
// Permissions outside the suite schemas are grouped with the module they control in the permission matrix.
const modules={students:'Students',teachers:'Teachers',parents:'Parents',overview:'Dashboard',school:'Settings',attendance:'Attendance',fees:'Fees',reports:'Reports',documents:'Documents',allocations:'Academics',announcements:'Communication',audit:'Reports',circulars:'Communication'}
function add(key,roles,group=modules[key.split('.')[0]]){entries.set(key,{key,group,defaults:roles})}
const all=['Administrator','Principal','Teacher','Parent','Student'],lead=all.slice(0,2)
add('platform.manage',['SuperAdmin'],'Platform')
for(const s of schemas){add(s.kind+'.view',s.read,s.group);if(s.write.length)add(s.kind+'.manage',s.write,s.group);if(!['academic-years','classes','subjects','fee-structures','exams','marks','school-config','certificates','admissions'].includes(s.kind))add(s.kind+'.archive',['Administrator'],s.group)}
for(const k of ['students','teachers','parents']){add(k+'.view',lead);for(const a of ['create','update','archive'])add(k+'.'+a,['Administrator'])}
for(const [k,r] of Object.entries({'overview.view':lead,'school.settings.view':lead,'school.settings.manage':['Administrator'],'attendance.view':all,'attendance.mark':all.slice(0,3),'fees.view':['Administrator','Principal','Parent','Student'],'fees.manage':['Administrator'],'fees.collect':['Administrator'],'reports.view':all,'documents.view':all,'documents.upload':all,'allocations.view':all,'allocations.manage':['Administrator'],'announcements.view':lead,'announcements.manage':lead,'audit.view':lead,'circulars.acknowledge':all}))add(k,r)
for(const k of ['users.view','users.create','users.update','users.disable','roles.view','roles.manage','roles.assign','permissions.view','signup.review','access-history.view'])add(k,['Administrator'],'Access control')
if([...entries.values()].some(e=>!e.group))throw Error('Every permission needs a module group.')
fs.writeFileSync('services/auth-service/PermissionCatalogue.json',JSON.stringify([...entries.values()],null,2)+'\n')
