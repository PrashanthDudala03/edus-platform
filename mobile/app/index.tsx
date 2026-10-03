import { Redirect } from 'expo-router'
import { Splash } from '@/components/Splash'
import { useSession } from '@/services'

/** The front door: wait for the stored session to be checked, then go where the person belongs. */
export default function Index() {
  const { status, welcomePending } = useSession()
  if (status === 'restoring') return <Splash />
  return <Redirect href={status === 'signed-in' ? (welcomePending ? '/welcome' : '/home') : '/login'} />
}
