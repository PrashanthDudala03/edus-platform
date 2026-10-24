import type { CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import client from '../api/client'
import { useAuthStore } from '../store/auth'
import { brandTheme, type Brand } from '../pages/home/schoolHome'
export function useSchoolBranding(): CSSProperties | undefined {
  const user = useAuthStore(s => s.user)
  const enabled = !!user?.schoolId && user.dataScope !== 'platform' && !user.roles.includes('SuperAdmin')
  const query = useQuery<{ schoolId: string, brand: Brand | null }>({
    queryKey: ['school-branding', user?.schoolId], enabled, retry: false,
    staleTime: 10000, refetchInterval: 15000, refetchOnWindowFocus: true,
    queryFn: async () => (await client.get('/suite/branding')).data.data,
  })
  if (!enabled || query.data?.schoolId !== user?.schoolId || !query.data?.brand || !(query.data.brand.primary || query.data.brand.accent)) return undefined
  const theme = brandTheme(query.data.brand)
  return { ...theme, '--green': theme['--sw-primary'], '--school-primary': theme['--sw-primary'], '--school-deep': theme['--sw-deep'], '--school-soft': theme['--sw-soft'], '--school-tint': theme['--sw-tint'], '--school-accent': theme['--sw-accent'], '--school-on-accent': theme['--sw-on-accent'] } as CSSProperties
}
