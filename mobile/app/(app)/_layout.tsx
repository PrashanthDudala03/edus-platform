import { useEffect } from 'react'
import { Redirect, Stack } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { experienceFor } from '@/access/experience'
import { Splash } from '@/components/Splash'
import { Button, EmptyState, Screen } from '@/components/ui'
import { api, session, useSession } from '@/services'
import type { User } from '@/session/types'
import { color } from '@/theme/tokens'

/**
 * Everything under (app) is behind this gate. A deep link to any of these screens lands here first, so a signed-out
 * person is sent to sign in and never sees the screen. While signed in, the account is re-read from EduOS every
 * minute and whenever the app returns to the front, so a changed role or permission takes effect without signing out.
 */
export default function AppLayout() {
  const { status, user } = useSession()
  const me = useQuery({ queryKey: ['me'], enabled: status === 'signed-in', refetchInterval: 60_000, queryFn: async () => (await api.get('/control/me')).data.data as User })
  useEffect(() => { if (me.data) session.updateUser(me.data) }, [me.data])

  if (status === 'restoring') return <Splash />
  if (status !== 'signed-in' || !user) return <Redirect href="/login" />
  // The platform administrator has no school; that work stays on the web.
  if (!experienceFor(user)) return <Screen scroll={false}><EmptyState icon="desktop-outline" title="Use EduOS on the web" message="This account manages the EduOS platform. The mobile app is for school accounts: parents, teachers, students and school leadership." />
    <Button label="Sign out" variant="secondary" icon="log-out-outline" onPress={() => { session.signOut() }} /></Screen>
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.background } }} />
}
