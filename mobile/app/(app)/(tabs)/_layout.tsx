import { StyleSheet, type ColorValue } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { tabsFor } from '@/access/experience'
import type { IconName } from '@/components/ui'
import { useBrand } from '@/features/school-home/api'
import { useSession } from '@/services'
import { color } from '@/theme/tokens'

// Every role has Home and Profile, with up to three of the role's own screens between them (five tabs at most).
// All other screens live here too, without a tab button: they open from Home or Profile and keep the bar in view.
// A screen the account has no entry for refuses to open, whatever the bar shows.
const ROLE_TABS = ['children', 'classes', 'timetable', 'overview', 'homework', 'results', 'register', 'leave', 'notices', 'fees', 'exams', 'notifications', 'student360'] as const
// The selected tab shows the filled icon, the others the outline, so the current place is obvious at a glance.
const icon = (name: IconName) => ({ color: tint, focused }: { color: ColorValue, size: number, focused: boolean }) => <Ionicons name={(focused ? name.replace('-outline', '') : name) as IconName} size={24} color={tint} />

export default function TabsLayout() {
  const user = useSession(state => state.user), tabs = tabsFor(user), brand = useBrand(), insets = useSafeAreaInsets()
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: brand.primary, tabBarInactiveTintColor: color.textFaint, tabBarHideOnKeyboard: true, animation: 'shift',
    tabBarStyle: { backgroundColor: color.surface, borderTopColor: color.border, borderTopWidth: StyleSheet.hairlineWidth, height: 62 + insets.bottom, paddingTop: 6, paddingBottom: insets.bottom + 6 },
    tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginTop: 2 }, tabBarItemStyle: { paddingVertical: 2 }, tabBarAllowFontScaling: false, sceneStyle: { backgroundColor: color.background } }}>
    <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: icon('home-outline') }} />
    {ROLE_TABS.map(name => { const entry = tabs.find(tab => tab.route === '/' + name)
      return <Tabs.Screen key={name} name={name} options={{ title: entry?.label ?? name, tabBarIcon: icon((entry?.icon ?? 'ellipse-outline') as IconName), ...(entry ? {} : { href: null }) }} /> })}
    <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person-circle-outline') }} />
  </Tabs>
}
