import { StyleSheet, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { QueryView } from '@/components/QueryView'
import { useRouter } from 'expo-router'
import { Header } from '@/components/blocks'
import { AppText, Avatar, Card, Notice, Screen } from '@/components/ui'
import { Ionicons } from '@expo/vector-icons'
import { color } from '@/theme/tokens'
import { usePermission } from '../data'
import { api } from '@/services'
import { space } from '@/theme/tokens'

// Teacher proof slice: the classes assigned to this teacher. GET /suite/records/classes already returns only the
// classes the signed-in teacher is class teacher of or teaches in; the app adds no filter of its own.
export interface SchoolClass { id: string, name: string, section: string, capacity: string }
export interface ClassPage { classes: SchoolClass[], total: number }

export function useMyClasses(enabled = true) {
  return useQuery({
    queryKey: ['records', 'classes'], enabled,
    queryFn: async (): Promise<ClassPage> => {
      const page = (await api.get('/suite/records/classes', { params: { page: 1 } })).data.data as { data: Record<string, unknown>[], totalCount: number }
      return { total: Number(page.totalCount) || 0, classes: page.data.map(row => ({ id: String(row.id ?? ''), name: String(row.name ?? ''), section: String(row.section ?? ''), capacity: String(row.capacity ?? '') })) }
    },
  })
}

export function ClassesScreen() {
  const classes = useMyClasses(), router = useRouter(), mayRegister = usePermission('attendance.view')
  return <Screen refreshing={classes.isRefetching} onRefresh={() => { classes.refetch() }}>
    <Header overline="Teaching" title="My classes" route="/classes" />
    <QueryView query={classes} isEmpty={page => page.classes.length === 0} empty={{ icon: 'easel-outline', title: 'No classes assigned yet', message: 'Classes appear here once the school assigns you as class teacher or adds you to a teaching assignment.' }}>
      {page => <View style={styles.list}>
        {page.classes.map(item => <Card key={item.id} label={'Open the register for ' + item.name} onPress={mayRegister ? () => router.navigate({ pathname: '/register', params: { class: item.name + ' - ' + item.section } }) : undefined}><View style={styles.row}><Avatar label={item.name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || 'C'} />
          <View style={styles.flex}><AppText variant="heading">{item.name}{item.section ? ' · ' + item.section : ''}</AppText>{!!item.capacity && <AppText variant="caption" tone="muted">Capacity {item.capacity}</AppText>}</View>
          {mayRegister && <Ionicons name="chevron-forward" size={18} color={color.textFaint} />}</View>{mayRegister && <AppText variant="caption" tone="primary" style={{ marginTop: 8 }}>Open register</AppText>}</Card>)}
        {/* The records API returns 20 per page and has no "all" option; say so rather than show a short list as complete. */}
        {page.total > page.classes.length && <Notice message={`Showing ${page.classes.length} of ${page.total} classes.`} />}
      </View>}
    </QueryView>
  </Screen>
}
const styles = StyleSheet.create({ flex: { flex: 1 }, list: { gap: space.md }, row: { flexDirection: 'row', alignItems: 'center', gap: space.md } })
