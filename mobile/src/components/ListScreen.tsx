import type { ReactElement, ReactNode } from 'react'
import { FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { normalizeError } from '@/api/errors'
import { color, space } from '@/theme/tokens'
import { EmptyState, ErrorState, LoadingState, type IconName } from './ui'

interface Source { isError: boolean, error: unknown, isRefetching: boolean, refetch: () => unknown }
/**
 * The frame for every list module: a header that scrolls with the list, pull-to-refresh, and the same loading, error
 * and empty states everywhere. Rows are virtualised, so long lists stay smooth.
 */
export function ListScreen<T>({ top, source, items, keyOf, row, empty, bottom, grouped = true }: {
  top: ReactNode, source: Source, items: T[] | undefined, keyOf: (item: T) => string, row: (item: T, index: number, all: T[]) => ReactElement,
  empty: { title: string, message: string, icon?: IconName }, bottom?: ReactNode, grouped?: boolean
}) {
  const refresh = <RefreshControl refreshing={source.isRefetching} onRefresh={() => { source.refetch() }} tintColor={color.primary} colors={[color.primary]} />
  return <SafeAreaView edges={['top']} style={styles.screen}>
    {items === undefined
      ? <ScrollView contentContainerStyle={styles.content} refreshControl={refresh}><View style={styles.top}>{top}</View>{source.isError ? <ErrorState error={normalizeError(source.error)} onRetry={() => { source.refetch() }} /> : <LoadingState />}</ScrollView>
      : <FlatList data={items} keyExtractor={keyOf} refreshControl={refresh} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" initialNumToRender={12} windowSize={9}
          ListHeaderComponent={<View style={styles.top}>{top}</View>} ListEmptyComponent={<EmptyState {...empty} />}
          renderItem={({ item, index }) => <View style={[grouped && styles.cell, grouped && index === 0 && styles.first, grouped && index === items.length - 1 && styles.last]}>{row(item, index, items)}</View>} />}
    {bottom}
  </SafeAreaView>
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.background }, content: { padding: space.lg, paddingBottom: space.xxxl }, top: { gap: space.lg, marginBottom: space.lg },
  cell: { backgroundColor: color.surface, borderLeftWidth: 1, borderRightWidth: 1, borderColor: color.border },
  first: { borderTopWidth: 1, borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: 'hidden' }, last: { borderBottomWidth: 1, borderBottomLeftRadius: 18, borderBottomRightRadius: 18, overflow: 'hidden' },
})
