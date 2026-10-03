import { useMemo, useState, type ReactNode } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { Image } from 'expo-image'
import { useQuery } from '@tanstack/react-query'
import { API_URL, api, session, useSession } from '@/services'
import { brandTheme } from '@/theme/brand'
import { color } from '@/theme/tokens'
import type { SchoolHomeResponse } from './model'

/** The published School Home for the signed-in person's school. `home` is null when the school has not published one. */
export function useSchoolHome() {
  const signedIn = useSession(state => state.status === 'signed-in')
  return useQuery({ queryKey: ['school-home'], enabled: signedIn, staleTime: 5 * 60_000, queryFn: async () => (await api.get('/suite/home')).data.data as SchoolHomeResponse })
}
/** The school's colours when it has published them, otherwise the EduOS palette. Text contrast is always preserved. */
export function useBrand() {
  const brand = useSchoolHome().data?.home?.brand
  return useMemo(() => brandTheme(brand), [brand?.primary, brand?.accent])
}

/**
 * A School Home image. The image endpoint needs the signed-in session, so the access token travels in a header, never
 * in the address. While loading, and if the image is missing or refused, the fallback is shown and nothing breaks.
 */
export function SchoolImage({ id, style, position = 'center', label, fallback }: { id: string, style?: StyleProp<ViewStyle>, position?: string, label?: string, fallback?: ReactNode }) {
  const [attempt, setAttempt] = useState(0), [failed, setFailed] = useState(false)
  const token = session.getAccessToken()
  return <View style={[styles.frame, style]}>
    <View style={styles.fill}>{fallback}</View>
    {!!id && !!token && !failed && <Image key={attempt} source={{ uri: `${API_URL}/suite/home/images/${id}`, headers: { Authorization: 'Bearer ' + token } }} style={styles.fill}
      contentFit="cover" contentPosition={position as 'center'} transition={200} cachePolicy="memory-disk" accessible={!!label} accessibilityLabel={label}
      // The token may have expired since the page loaded: refresh once and try again before giving up.
      onError={() => { if (attempt === 0) session.refresh().catch(() => undefined).finally(() => setAttempt(1)); else setFailed(true) }} />}
  </View>
}
const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: color.surfaceMuted },
  fill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
})
