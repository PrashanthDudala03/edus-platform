import type { ReactNode } from 'react'
import { apiError } from '@/api/errors'
import { ErrorState, Screen } from '@/components/ui'
import { useSession } from '@/services'
import { canOpen, type Destination } from './experience'

/**
 * Keeps a screen from being opened by an account that has no entry for it, for example through a deep link.
 * This is a courtesy, not the protection: the API refuses the data regardless, and the screen then shows that refusal.
 */
export function Guard({ route, children }: { route: Destination, children: ReactNode }) {
  const user = useSession(state => state.user)
  return canOpen(user, route) ? <>{children}</> : <Screen><ErrorState error={apiError('forbidden')} /></Screen>
}
