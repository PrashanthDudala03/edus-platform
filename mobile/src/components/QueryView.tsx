import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNetInfo } from '@react-native-community/netinfo'
import { Ionicons } from '@expo/vector-icons'
import { normalizeError } from '@/api/errors'
import { color, elevation, radius, space } from '@/theme/tokens'
import { AppText, EmptyState, ErrorState, LoadingState, type IconName } from './ui'

/** Draws a query's four states the same way everywhere: loading, failed, empty and loaded. */
export function QueryView<T>({ query, isEmpty, empty, rows, children }: {
  query: { data: T | undefined, isError: boolean, error: unknown, refetch: () => unknown }, isEmpty?: (data: T) => boolean, empty: { title: string, message: string, icon?: IconName }, rows?: number, children: (data: T) => ReactNode
}) {
  if (query.data === undefined) return query.isError ? <ErrorState error={normalizeError(query.error)} onRetry={() => { query.refetch() }} /> : <LoadingState rows={rows} />
  if (isEmpty?.(query.data)) return <EmptyState {...empty} />
  return <>{children(query.data)}</>
}

/** A small floating notice while the device has no connection. Requests pause and resume by themselves. */
export function OfflineBanner() {
  const { isConnected } = useNetInfo(), insets = useSafeAreaInsets()
  if (isConnected !== false) return null
  return <View pointerEvents="none" accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.banner, { bottom: insets.bottom + 76 }]}>
    <Ionicons name="cloud-offline-outline" size={17} color={color.onPrimary} /><AppText variant="label" tone="inverse">You are offline. Showing what was last loaded.</AppText></View>
}
const styles = StyleSheet.create({
  banner: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.pill, backgroundColor: color.text, maxWidth: '92%', ...elevation.raised },
})
