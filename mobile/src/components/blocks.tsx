import { Children, Fragment, isValidElement, type ReactNode } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { tabsFor, type Destination } from '@/access/experience'
import { useSession } from '@/services'
import { color, elevation, radius, space, touch } from '@/theme/tokens'
import { AppText, type IconName } from './ui'

// Composite pieces shared by the module screens: the screen header, filter chips, list rows, stat tiles and the
// bottom sheet. They keep every module looking and behaving the same way.

/** The top of a module screen. A screen that is not one of the person's tabs gets a way back to Home. */
export function Header({ title, overline, route, right }: { title: string, overline?: string, route: Destination, right?: ReactNode }) {
  const router = useRouter(), user = useSession(state => state.user)
  const isTab = route === '/home' || route === '/profile' || tabsFor(user).some(tab => tab.route === route)
  return <View style={styles.header}>
    {!isTab && <Pressable accessibilityRole="button" accessibilityLabel="Back to Home" hitSlop={8} onPress={() => router.navigate('/home')} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><Ionicons name="chevron-back" size={22} color={color.text} /></Pressable>}
    <View style={styles.flex}>{!!overline && <AppText variant="overline" tone="primary">{overline}</AppText>}<AppText variant="title" accessibilityRole="header" numberOfLines={1}>{title}</AppText></View>{right}</View>
}

export interface ChipOption { key: string, label: string, count?: number }
/** One-line filter chips that scroll sideways. */
export function Chips({ options, value, onChange, style, wrap }: { options: ChipOption[], value: string, onChange: (key: string) => void, style?: StyleProp<ViewStyle>,
  /** A choice in a form: every option stays visible and wraps onto more lines, instead of scrolling sideways like a filter. */ wrap?: boolean }) {
  const chips = options.map(option => { const active = option.key === value
      return <Pressable key={option.key} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={option.label + (option.count === undefined ? '' : ', ' + option.count)} onPress={() => onChange(option.key)}
        style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}>
        <AppText variant="label" tone={active ? 'inverse' : 'muted'}>{option.label}{option.count === undefined ? '' : ' · ' + option.count}</AppText></Pressable> })
  return wrap ? <View style={[styles.chips, styles.chipsWrap, style]} accessibilityRole="tablist">{chips}</View>
    : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, style]} accessibilityRole="tablist">{chips}</ScrollView>
}

/** A row in a list: something leading, a title with supporting lines, and something trailing. */
export function ListItem({ leading, icon, title, subtitle, meta, trailing, onPress, last }: {
  leading?: ReactNode, icon?: IconName, title: string, subtitle?: string, meta?: string, trailing?: ReactNode, onPress?: () => void, last?: boolean
}) {
  const body = <>{leading ?? (icon ? <View style={styles.rowIcon}><Ionicons name={icon} size={19} color={color.primary} /></View> : null)}
    <View style={styles.flex}><AppText variant="bodyStrong" numberOfLines={2}>{title}</AppText>{!!subtitle && <AppText variant="caption" tone="muted" numberOfLines={2}>{subtitle}</AppText>}{!!meta && <AppText variant="caption" tone="primary">{meta}</AppText>}</View>
    {trailing}{onPress && !trailing && <Ionicons name="chevron-forward" size={17} color={color.textFaint} />}</>
  const frame = [styles.row, !last && styles.rowDivider]
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [frame, pressed && styles.rowPressed]}>{body}</Pressable> : <View style={frame}>{body}</View>
}
/** A white panel that groups list rows without nesting cards. */
export function Group({ title, action, children, style }: { title?: string, action?: ReactNode, children: ReactNode, style?: StyleProp<ViewStyle> }) {
  return <View style={style}>{(!!title || !!action) && <View style={styles.groupHead}><AppText variant="overline" tone="muted" style={styles.flex}>{title}</AppText>{action}</View>}<View style={styles.group}>{children}</View></View>
}
export function LinkText({ label, onPress }: { label: string, onPress: () => void }) {
  return <Pressable accessibilityRole="link" hitSlop={10} onPress={onPress}><AppText variant="label" tone="primary">{label}</AppText></Pressable>
}

/** A single figure with its label. Tappable when it leads somewhere. */
export function StatTile({ value, label, note, tone = 'default', onPress }: { value: string, label: string, note?: string, tone?: 'default' | 'warning', onPress?: () => void }) {
  const body = <><AppText variant="title" tone={tone === 'warning' ? 'danger' : 'primary'} numberOfLines={1} adjustsFontSizeToFit>{value}</AppText><AppText variant="label" numberOfLines={1}>{label}</AppText>{!!note && <AppText variant="caption" tone="muted" numberOfLines={2}>{note}</AppText>}</>
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={({ pressed }) => [styles.stat, pressed && styles.pressed]}>{body}</Pressable> : <View style={styles.stat}>{body}</View>
}
export function StatRow({ children }: { children: ReactNode }) { return <View style={styles.statRow}>{children}</View> }

/** A sheet that rises from the bottom for a detail view or a short form. It stays above the keyboard. */
export function Sheet({ visible, title, onClose, children, footer }: { visible: boolean, title: string, onClose: () => void, children: ReactNode, footer?: ReactNode }) {
  const insets = useSafeAreaInsets()
  // Related actions (Approve, Reject) sit side by side at equal width instead of one under another.
  const actions = Children.toArray(isValidElement(footer) && footer.type === Fragment ? (footer.props as { children?: ReactNode }).children : footer)
  return <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Pressable accessibilityLabel="Close" style={styles.scrim} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]} accessibilityViewIsModal>
        <View style={styles.handle} />
        <View style={styles.sheetHead}><AppText variant="heading" style={styles.flex} accessibilityRole="header">{title}</AppText>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={onClose} style={styles.close}><Ionicons name="close" size={20} color={color.textMuted} /></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>{children}</ScrollView>
        {actions.length > 0 && <View style={styles.sheetFoot}>{actions.map((action, i) => <View key={i} style={styles.flex}>{action}</View>)}</View>}
      </View>
    </KeyboardAvoidingView></Modal>
}

/** Steps a date or month one unit at a time. */
export function Stepper({ label, onPrevious, onNext, nextDisabled, previousDisabled }: { label: string, onPrevious: () => void, onNext: () => void, nextDisabled?: boolean, previousDisabled?: boolean }) {
  return <View style={styles.stepper}>
    <Pressable accessibilityRole="button" accessibilityLabel="Previous" disabled={previousDisabled} onPress={onPrevious} style={[styles.step, previousDisabled && styles.off]}><Ionicons name="chevron-back" size={20} color={color.text} /></Pressable>
    <AppText variant="bodyStrong" accessibilityLiveRegion="polite">{label}</AppText>
    <Pressable accessibilityRole="button" accessibilityLabel="Next" disabled={nextDisabled} onPress={onNext} style={[styles.step, nextDisabled && styles.off]}><Ionicons name="chevron-forward" size={20} color={color.text} /></Pressable></View>
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, pressed: { opacity: 0.7 }, off: { opacity: 0.3 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touch }, back: { width: touch - 8, height: touch - 8, borderRadius: radius.pill, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, alignItems: 'center', justifyContent: 'center' },
  chips: { gap: space.sm, paddingRight: space.lg }, chip: { minHeight: 38, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, alignItems: 'center', justifyContent: 'center' }, chipActive: { backgroundColor: color.primary, borderColor: color.primary },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md + 2, paddingHorizontal: space.lg, minHeight: touch + 8 }, rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border }, rowPressed: { backgroundColor: color.surfaceMuted },
  rowIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.successSurface, alignItems: 'center', justifyContent: 'center' },
  groupHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.sm, paddingHorizontal: space.xs }, group: { backgroundColor: color.surface, borderRadius: radius.lg, overflow: 'hidden', ...elevation.card },
  statRow: { flexDirection: 'row', gap: space.md }, stat: { flex: 1, backgroundColor: color.surface, borderRadius: radius.lg, padding: space.lg, gap: 2, ...elevation.card },
  scrim: { flex: 1, backgroundColor: color.overlay }, sheet: { backgroundColor: color.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '88%', ...elevation.raised },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: color.border, marginTop: space.sm }, sheetHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.sm },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: color.surfaceMuted, alignItems: 'center', justifyContent: 'center' }, sheetBody: { paddingHorizontal: space.xl, paddingBottom: space.lg, gap: space.md }, chipsWrap: { flexWrap: 'wrap' }, sheetFoot: { flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: space.xl, paddingTop: space.md, gap: space.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: color.surface, borderRadius: radius.md, borderWidth: 1, borderColor: color.border }, step: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
})
