import type { User } from './store/auth'
import { homeFor, roleOf } from './roles'
const dashboards=['/admin','/principal','/teacher','/parent','/student']
export function permissionForPath(path:string):string|undefined {
 if(path.startsWith('/control'))return path.includes('signup-requests')?'signup.review':path.includes('access-history')?'access-history.view':path.includes('/users')?'users.view':path.includes('/permissions')?'permissions.view':'roles.view'
 const fixed:Record<string,string>={'/students':'students.view','/teachers':'teachers.view','/parents':'parents.view','/attendance':'attendance.view','/announcements':'announcements.view','/audit':'audit.view','/settings':'school.settings.manage','/admin':'overview.view','/principal':'overview.view','/suite/fees':'fees.view','/suite/register':'attendance.mark','/suite/reports':'reports.view','/suite/allocation':'allocations.manage'}
 return fixed[path]||(path.startsWith('/suite/')?path.split('/')[2]+'.view':undefined)
}
export function canVisit(user:User|null,path:string):boolean {
 if(!user)return false
 if(path.startsWith('/super-admin'))return user.dataScope==='platform'
 if(user.dataScope==='platform')return false
 const permission=permissionForPath(path)
 if(permission&&!user.permissions.includes(permission))return false
 // A role dashboard is that role's home page, never a second view for another role.
 if(dashboards.includes(path))return homeFor(roleOf(user),user.dataScope)===path
 if(['/students','/teachers','/parents','/attendance','/announcements','/audit','/settings'].includes(path))return user.dataScope==='school'
 return true
}
