// Generates the initial catalogue from implemented suite modules. Runtime grants live in PostgreSQL.
import fs from 'node:fs'
const schemas=JSON.parse(fs.readFileSync('services/school-service/SuiteSchemas.json','utf8'))
const entries=new Map()
// Permissions outside the suite schemas are grouped with the module they control in the permission matrix.
const modules={students:'Students',teachers:'Teachers',parents:'Parents',overview:'Dashboard',school:'Settings',attendance:'Attendance',fees:'Fees',reports:'Reports',documents:'Documents',allocations:'Academics',announcements:'Communication',audit:'Reports',circulars:'Communication'}
function add(key,roles,group=modules[key.split('.')[0]]){entries.set(key,{key,group,defaults:roles})}
const all=['Administrator','Principal','Teacher','Parent','Student'],lead=all.slice(0,2)
add('platform.manage',['SuperAdmin'],'Platform')
for(const s of schemas){add(s.kind+'.view',s.read,s.group);if(s.write.length)add(s.kind+'.manage',s.write,s.group);if(!['academic-years','classes','subjects','fee-structures','exams','marks','school-config','certificates','admissions','leave-types','leave-adjustments'].includes(s.kind))add(s.kind+'.archive',['Administrator'],s.group)}
for(const k of ['students','teachers','parents']){add(k+'.view',lead);for(const a of ['create','update','archive'])add(k+'.'+a,['Administrator'])}
for(const [k,r] of Object.entries({'overview.view':lead,'school.settings.view':lead,'school.settings.manage':['Administrator'],'attendance.view':all,'attendance.mark':all.slice(0,3),'fees.view':['Administrator','Principal','Parent','Student'],'fees.manage':['Administrator'],'fees.collect':['Administrator'],'reports.view':all,'documents.view':all,'documents.upload':all,'allocations.view':all,'allocations.manage':['Administrator'],'announcements.view':lead,'announcements.manage':lead,'audit.view':lead,'circulars.acknowledge':all}))add(k,r)
// School Home and notification wording are managed from Settings (granted to existing schools by auth migrations).
add('school-home.manage',['Administrator'],'Settings');add('notifications.manage',['Administrator'],'Settings')
// Deciding leave is a capability of its own: a teacher who may request leave never holds it.
add('leave-requests.approve',lead,'Attendance')
// Admissions decisions and onboarding are separate from editing applications; teachers and families hold neither.
add('admissions.approve',lead,'Admissions');add('onboarding.manage',['Administrator'],'Admissions')
for(const k of ['users.view','users.create','users.update','users.disable','roles.view','roles.manage','roles.assign','permissions.view','signup.review','access-history.view'])add(k,['Administrator'],'Access control')
// Platform billing stays with the SuperAdmin; a school administrator only sees and pays for the school subscription.
for(const k of ["billing.view","billing.plans.manage","billing.offers.manage","billing.subscriptions.manage","billing.payments.view","billing.settings.manage"])add(k,["SuperAdmin"],"Billing")
for(const k of ["subscription.view","subscription.purchase"])add(k,["Administrator"],"Billing")
// AI is off by default: no role holds these until the platform administrator grants them.
for(const k of ["ai.assistant.use","ai.knowledge.manage","ai.usage.view"])add(k,[],"AI")
add("ai.platform.manage",["SuperAdmin"],"AI")
if([...entries.values()].some(e=>!e.group))throw Error('Every permission needs a module group.')
fs.writeFileSync('services/auth-service/PermissionCatalogue.json',JSON.stringify([...entries.values()],null,2)+'\n')
