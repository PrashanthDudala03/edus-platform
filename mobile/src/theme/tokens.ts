import { Platform, type TextStyle, type ViewStyle } from 'react-native'

// The EduOS mobile design tokens. Screens use these names, never raw numbers or colours, so the app stays consistent
// and a school's brand can be laid over it in a few known places (hero, primary actions, highlights).
export const color = {
  background: '#f2f5f3',
  surface: '#ffffff',
  surfaceMuted: '#f0f4f2',
  border: '#e3e9e6',
  text: '#16231e',
  textMuted: '#526459',
  textFaint: '#7a8a81',
  primary: '#167865',
  primaryDeep: '#0c4237',
  onPrimary: '#ffffff',
  danger: '#a83838',
  dangerSurface: '#fbeeee',
  warningSurface: '#fff7e0',
  warningText: '#6b4e0d',
  successSurface: '#eaf5ee',
  successText: '#27633f',
  overlay: 'rgba(12, 31, 26, 0.55)',
} as const

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const
export const radius = { sm: 8, md: 14, lg: 20, xl: 26, pill: 999 } as const
/** The smallest comfortable touch target on both platforms. */
export const touch = 48

export const type = {
  display: { fontSize: 32, lineHeight: 37, fontWeight: '800', letterSpacing: -0.9 },
  title: { fontSize: 23, lineHeight: 28, fontWeight: '700', letterSpacing: -0.5 },
  heading: { fontSize: 17, lineHeight: 23, fontWeight: '700', letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  overline: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 1.6, textTransform: 'uppercase' },
} as const satisfies Record<string, TextStyle>
export type TypeVariant = keyof typeof type

const shadow = (height: number, blur: number, opacity: number, elevation: number): ViewStyle =>
  Platform.select<ViewStyle>({ android: { elevation }, default: { shadowColor: '#0d1f1a', shadowOffset: { width: 0, height }, shadowRadius: blur, shadowOpacity: opacity } }) as ViewStyle
export const elevation = { none: {}, card: shadow(3, 10, 0.05, 1), raised: shadow(10, 22, 0.1, 4) } as const
