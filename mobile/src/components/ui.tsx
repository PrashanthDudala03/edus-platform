import { forwardRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle } from 'react-native'
import { SafeAreaView, type Edge } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import type { ApiError } from '@/api/errors'
import { color, elevation, radius, space, touch, type, type TypeVariant } from '@/theme/tokens'

// The EduOS mobile building blocks. Screens are composed from these; they do not style raw views themselves.
export type IconName = keyof typeof Ionicons.glyphMap

export function AppText({ variant = 'body', tone = 'default', style, ...rest }: TextProps & { variant?: TypeVariant, tone?: 'default' | 'muted' | 'faint' | 'inverse' | 'danger' | 'primary' }) {
  const tint = tone === 'muted' ? color.textMuted : tone === 'faint' ? color.textFaint : tone === 'inverse' ? color.onPrimary : tone === 'danger' ? color.danger : tone === 'primary' ? color.primary : color.text
  return <Text {...rest} style={[type[variant] as TextStyle, { color: tint }, style]} />
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export function Button({ label, onPress, variant = 'primary', icon, loading, disabled, tint, onTint, style }: {
  label: string, onPress: () => void, variant?: ButtonVariant, icon?: IconName, loading?: boolean, disabled?: boolean,
  /** A school brand colour for the primary button, with the text colour that is readable on it. */
  tint?: string, onTint?: string, style?: StyleProp<ViewStyle>
}) {
  const inactive = disabled || loading
  const background = variant === 'primary' ? tint ?? color.primary : variant === 'danger' ? color.dangerSurface : variant === 'secondary' ? color.surface : 'transparent'
  const foreground = variant === 'primary' ? onTint ?? color.onPrimary : variant === 'danger' ? color.danger : color.text
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!inactive, busy: !!loading }} disabled={inactive} onPress={onPress}
    style={({ pressed }) => [styles.button, { backgroundColor: background }, variant === 'secondary' && styles.buttonOutline, inactive && styles.dimmed, pressed && styles.pressed, style]}>
    {loading ? <ActivityIndicator color={foreground} /> : <>{icon && <Ionicons name={icon} size={19} color={foreground} />}<Text style={[type.bodyStrong as TextStyle, { color: foreground }]}>{label}</Text></>}
  </Pressable>
}

export function Card({ children, onPress, style, label }: { children: ReactNode, onPress?: () => void, style?: StyleProp<ViewStyle>, label?: string }) {
  if (!onPress) return <View style={[styles.card, style]}>{children}</View>
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}>{children}</Pressable>
}

export function Badge({ label, tone = 'neutral' }: { label: string, tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'primary' }) {
  const [background, foreground] = tone === 'success' ? [color.successSurface, color.successText] : tone === 'warning' ? [color.warningSurface, color.warningText] : tone === 'danger' ? [color.dangerSurface, color.danger] : tone === 'primary' ? [color.primary, color.onPrimary] : [color.surfaceMuted, color.textMuted]
  return <View style={[styles.badge, { backgroundColor: background }]}><Text style={[type.caption as TextStyle, { color: foreground, fontWeight: '600' }]}>{label}</Text></View>
}

export function Avatar({ label, size = 44, background = color.surfaceMuted, foreground = color.primaryDeep }: { label: string, size?: number, background?: string, foreground?: string }) {
  return <View accessible={false} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: background, alignItems: 'center', justifyContent: 'center' }}>
    <Text style={{ color: foreground, fontSize: size * 0.38, fontWeight: '700' }}>{label}</Text></View>
}

export function SectionHeader({ title, overline, action, inverse }: { title: string, overline?: string, action?: ReactNode, inverse?: boolean }) {
  return <View style={styles.sectionHeader}><View style={styles.flex}>
    {overline && <AppText variant="overline" tone={inverse ? 'inverse' : 'primary'} style={styles.overline}>{overline}</AppText>}
    <AppText variant="title" tone={inverse ? 'inverse' : 'default'} accessibilityRole="header">{title}</AppText></View>{action}</View>
}

export const TextField = forwardRef<TextInput, TextInputProps & { label: string, error?: string, secure?: boolean }>(function TextField({ label, error, secure, style, ...rest }, ref) {
  const [hidden, setHidden] = useState(!!secure), [focused, setFocused] = useState(false)
  return <View style={styles.field}>
    <AppText variant="label" tone="muted">{label}</AppText>
    <View style={[styles.input, focused && styles.inputFocused, !!error && styles.inputError]}>
      <TextInput ref={ref} accessibilityLabel={label} placeholderTextColor={color.textFaint} secureTextEntry={hidden} {...rest}
        onFocus={event => { setFocused(true); rest.onFocus?.(event) }} onBlur={event => { setFocused(false); rest.onBlur?.(event) }} style={[styles.inputText, style]} />
      {secure && <Pressable accessibilityRole="button" accessibilityLabel={hidden ? 'Show password' : 'Hide password'} hitSlop={12} onPress={() => setHidden(!hidden)} style={styles.inputAction}>
        <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={20} color={color.textMuted} /></Pressable>}
    </View>
    {!!error && <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">{error}</AppText>}
  </View>
})

/** A message with an icon: information, a warning (session ended, offline) or an error. */
export function Notice({ message, tone = 'info', action }: { message: string, tone?: 'info' | 'warning' | 'danger', action?: ReactNode }) {
  const [background, foreground, icon] = tone === 'danger' ? [color.dangerSurface, color.danger, 'alert-circle-outline' as IconName] : tone === 'warning' ? [color.warningSurface, color.warningText, 'information-circle-outline' as IconName] : [color.surfaceMuted, color.textMuted, 'information-circle-outline' as IconName]
  return <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: background }]}><Ionicons name={icon} size={20} color={foreground} />
    <View style={styles.flex}><Text style={[type.body as TextStyle, { color: foreground }]}>{message}</Text>{action}</View></View>
}

export function Skeleton({ height = 16, width = '100%', style }: { height?: number, width?: ViewStyle['width'], style?: StyleProp<ViewStyle> }) {
  return <View accessible={false} style={[{ height, width, borderRadius: radius.sm, backgroundColor: color.surfaceMuted }, style]} />
}
export function LoadingState({ rows = 3 }: { rows?: number }) {
  return <View accessibilityRole="progressbar" accessibilityLabel="Loading" style={styles.stack}>{Array.from({ length: rows }, (_, i) => <View key={i} style={styles.card}><Skeleton width="45%" /><Skeleton height={12} style={styles.gapTop} /><Skeleton height={12} width="70%" style={styles.gapTop} /></View>)}</View>
}
export function EmptyState({ icon = 'file-tray-outline', title, message }: { icon?: IconName, title: string, message: string }) {
  return <View style={styles.state}><View style={styles.stateIcon}><Ionicons name={icon} size={26} color={color.textMuted} /></View>
    <AppText variant="heading" style={styles.center}>{title}</AppText><AppText tone="muted" style={styles.center}>{message}</AppText></View>
}
/** Shows a normalised error. Retry is offered only when trying again can help; a refusal (403) is stated plainly. */
export function ErrorState({ error, onRetry }: { error: ApiError, onRetry?: () => void }) {
  const refused = error.kind === 'forbidden'
  return <View style={styles.state}><View style={[styles.stateIcon, { backgroundColor: refused ? color.surfaceMuted : color.dangerSurface }]}><Ionicons name={refused ? 'lock-closed-outline' : error.kind === 'offline' ? 'cloud-offline-outline' : 'alert-circle-outline'} size={26} color={refused ? color.textMuted : color.danger} /></View>
    <AppText variant="heading" style={styles.center}>{refused ? 'Not available for your account' : error.kind === 'offline' ? 'You are offline' : 'This could not be loaded'}</AppText>
    <AppText tone="muted" style={styles.center}>{error.message}</AppText>
    {onRetry && error.retryable && <Button label="Try again" variant="secondary" icon="refresh" onPress={onRetry} style={styles.gapTop} />}</View>
}

/** The frame of every screen: safe areas, the page background and (optionally) scrolling with pull-to-refresh. */
export function Screen({ children, scroll = true, refreshing, onRefresh, edges = ['top'], padded = true, style }: {
  children: ReactNode, scroll?: boolean, refreshing?: boolean, onRefresh?: () => void, edges?: Edge[], padded?: boolean, style?: StyleProp<ViewStyle>
}) {
  return <SafeAreaView edges={edges} style={[styles.screen, style]}>
    {scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[padded && styles.padded, styles.scrollEnd]}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={color.primary} colors={[color.primary]} /> : undefined}>{children}</ScrollView>
      : <View style={[styles.flex, padded && styles.padded]}>{children}</View>}
  </SafeAreaView>
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, center: { textAlign: 'center' }, stack: { gap: space.md }, gapTop: { marginTop: space.md }, overline: { marginBottom: space.xs },
  screen: { flex: 1, backgroundColor: color.background }, padded: { padding: space.lg, gap: space.lg }, scrollEnd: { paddingBottom: space.xxxl },
  button: { minHeight: touch + 4, borderRadius: radius.md, paddingHorizontal: space.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  buttonOutline: { borderWidth: 1, borderColor: color.border }, dimmed: { opacity: 0.55 }, pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  card: { backgroundColor: color.surface, borderRadius: radius.lg, padding: space.lg, ...elevation.card },
  badge: { alignSelf: 'flex-start', paddingHorizontal: space.sm + 2, paddingVertical: 3, borderRadius: radius.pill },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  field: { gap: space.sm },
  input: { minHeight: touch + 4, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: color.border, borderRadius: radius.md, backgroundColor: color.surface, paddingHorizontal: space.lg },
  inputFocused: { borderColor: color.primary }, inputError: { borderColor: color.danger },
  inputText: { flex: 1, fontSize: 16, color: color.text, paddingVertical: space.md }, inputAction: { minWidth: touch - 8, minHeight: touch - 8, alignItems: 'center', justifyContent: 'center' },
  notice: { flexDirection: 'row', gap: space.md, padding: space.lg, borderRadius: radius.md, alignItems: 'flex-start' },
  state: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.xl },
  stateIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: color.surfaceMuted, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
})
