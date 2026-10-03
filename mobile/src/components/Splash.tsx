import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { color, radius, space } from '@/theme/tokens'
import { AppText } from './ui'

/** Shown while the app decides who is signed in. It never shows data. */
export function Splash({ message }: { message?: string }) {
  return <View style={styles.page} accessibilityRole="progressbar" accessibilityLabel={message ?? 'Opening EduOS'}>
    <View style={styles.mark}><Ionicons name="school" size={34} color={color.onPrimary} /></View>
    <ActivityIndicator color={color.primary} />{!!message && <AppText tone="muted">{message}</AppText>}</View>
}
const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl, backgroundColor: color.background },
  mark: { width: 72, height: 72, borderRadius: radius.xl, backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center' },
})
