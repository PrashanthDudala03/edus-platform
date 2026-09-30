import { Link } from 'react-router-dom'
import { ShieldAlert, ArrowRight } from 'lucide-react'
import { useAuthStore } from '../store/auth'
import { homeFor, portalName, roleOf, type Role } from '../roles'
export function ForbiddenPage(){
 const role=roleOf(useAuthStore(s=>s.user))
 return <section className="panel forbidden-page" aria-labelledby="forbidden-title"><span className="stat-icon peach"><ShieldAlert size={26}/></span><span className="eyebrow">403 · ACCESS NOT AVAILABLE</span><h1 id="forbidden-title">This area isn’t available for your role</h1><p>Your account{role?' ('+role+')':''} does not have permission to open this page. If you think it should, contact your school administrator.</p><Link className="button primary" to={homeFor(role)}>Go to my {role?portalName[role as Role]:'workspace'}<ArrowRight size={16}/></Link></section>
}
