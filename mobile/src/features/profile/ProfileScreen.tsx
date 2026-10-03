import { useState } from 'react'
import { Alert, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { EXPERIENCE_LABEL, experienceFor, navigationFor } from '@/access/experience'
import { Group, Header, ListItem } from '@/components/blocks'
import { AppText, Avatar, Button, Card, Screen, type IconName } from '@/components/ui'
import { session, useSession } from '@/services'
import { color, space } from '@/theme/tokens'
import { initials } from '@/utils/format'
import { useSchoolName } from '../home/HomeScreen'

// Who is signed in, and the way out. Only what the person already knows about themselves is shown: no tokens,
// identifiers or permission keys.
const SCOPE: Record<string, string> = { parent: 'Your linked children', teacher: 'Your assigned classes', student: 'Your own records', school: 'The whole school' }

function Row({ label, value }: { label: string, value: string }) {
  return <View style={styles.row}><AppText variant="caption" tone="muted" style={styles.term}>{label}</AppText><AppText variant="bodyStrong" style={styles.value}>{value}</AppText></View>
}
export function ProfileScreen() {
  const user = useSession(state => state.user), school = useSchoolName(), [leaving, setLeaving] = useState(false), router = useRouter()
  // Screens that are not in the bottom bar for this role are listed here as well as on Home.
  const more = navigationFor(user).filter(entry => entry.route && !entry.tab)
  if (!user) return null
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username, experience = experienceFor(user)
  const signOut = () => Alert.alert('Sign out of EduOS?', 'You will need your password to sign in again on this phone.', [
    { text: 'Stay signed in', style: 'cancel' },
    { text: 'Sign out', style: 'destructive', onPress: () => { setLeaving(true); session.signOut().finally(() => setLeaving(false)) } },
  ])
  return <Screen>
    <Header overline="Account" title="Profile" route="/profile" />
    <Card style={styles.identity}><Avatar label={initials(name) || 'U'} size={64} background={color.primary} foreground={color.onPrimary} />
      <View style={styles.flex}><AppText variant="title" numberOfLines={2}>{name}</AppText><AppText tone="muted" numberOfLines={1}>{user.roles.join(', ') || 'Not assigned'}</AppText></View></Card>
    <Card style={styles.details}>
      <Row label="Sign-in name" value={user.username} />
      {!!user.email && user.email !== user.username && <Row label="Email" value={user.email} />}
      {!!school && <Row label="School" value={school} />}
      <Row label="Role" value={user.roles.join(', ') || 'Not assigned'} />
      {!!experience && <Row label="App experience" value={EXPERIENCE_LABEL[experience]} />}
      {!!user.dataScope && !!SCOPE[user.dataScope] && <Row label="What you can see" value={SCOPE[user.dataScope]} />}
    </Card>
    {more.length > 0 && <Group title="More">{more.map((entry, i) => <ListItem key={entry.key} icon={entry.icon as IconName} title={entry.label} subtitle={entry.summary} onPress={() => router.navigate(entry.route!)} last={i === more.length - 1} />)}</Group>}
    <Button label="Sign out" variant="danger" icon="log-out-outline" loading={leaving} onPress={signOut} />
    <AppText variant="caption" tone="faint" style={styles.center}>Signing out removes your session from this phone.</AppText>
  </Screen>
}
const styles = StyleSheet.create({
  flex: { flex: 1 }, center: { textAlign: 'center' }, identity: { flexDirection: 'row', alignItems: 'center', gap: space.lg }, details: { gap: space.md }, row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md }, term: { width: 104, paddingTop: 3 }, value: { flex: 1 },
})
