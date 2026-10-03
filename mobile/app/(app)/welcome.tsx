import { useEffect } from 'react'
import { useRouter } from 'expo-router'
import { Splash } from '@/components/Splash'
import { SchoolHomeScreen } from '@/features/school-home/SchoolHomeScreen'
import { useSchoolHome } from '@/features/school-home/api'
import { session, useSession } from '@/services'

/** School Home, shown once after signing in. A school with nothing published goes straight on, as on the web. */
export default function Welcome() {
  const router = useRouter(), firstName = useSession(state => state.user?.firstName), home = useSchoolHome()
  const published = home.data?.home, settled = !home.isPending
  const enter = () => { session.welcomeShown(); router.replace('/home') }
  useEffect(() => { if (settled && !published) enter() }, [settled, published])
  if (!published) return <Splash />
  return <SchoolHomeScreen home={published} firstName={firstName} onEnter={enter} />
}
