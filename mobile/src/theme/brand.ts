// School branding. A school sets two colours in School Home; everything else is derived here so text stays readable
// whatever was chosen. The same rules as the web welcome page, so a school looks the same in both.
export interface Brand { primary: string, accent: string }
export interface BrandTheme {
  /** The school colour, darkened if needed so white text on it is readable. */
  primary: string
  /** A much darker shade for hero and footer backgrounds. */
  deep: string
  /** A very light wash for section backgrounds. */
  tint: string
  /** A light shade for chips and placeholders. */
  soft: string
  /** Muted text on the deep background. */
  muted: string
  accent: string
  /** Text colour that is readable on the accent. */
  onAccent: string
}

type Rgb = [number, number, number]
const HEX = /^#[0-9a-f]{6}$/i
const rgb = (colour: string) => [1, 3, 5].map(i => parseInt(colour.slice(i, i + 2), 16)) as Rgb
export const mix = (from: string, to: string, share: number) => '#' + rgb(from).map((v, i) => Math.round(v + (rgb(to)[i] - v) * share).toString(16).padStart(2, '0')).join('')
function luminance(colour: string) {
  const [r, g, b] = rgb(colour).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** WCAG contrast ratio between two colours, from 1 to 21. */
export function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}
/** Darkens a colour in small steps until white text on it reaches the given contrast. */
export function readable(colour: string, ratio = 5.5) {
  let result = colour
  for (let step = 0; step < 30 && contrast(result, '#ffffff') < ratio; step++) result = mix(result, '#000000', 0.08)
  return result
}

export const EDUOS_BRAND: Brand = { primary: '#167865', accent: '#89c6b3' }
const DARK_TEXT = '#14211c'

/** A missing or malformed colour falls back to the EduOS palette; nothing from the server is used as a colour unchecked. */
export function brandTheme(brand?: Partial<Brand> | null): BrandTheme {
  const primary = readable(HEX.test(brand?.primary || '') ? brand!.primary! : EDUOS_BRAND.primary)
  const accent = HEX.test(brand?.accent || '') ? brand!.accent!.toLowerCase() : EDUOS_BRAND.accent
  return {
    primary, deep: mix(primary, '#000000', 0.45), tint: mix(primary, '#ffffff', 0.94), soft: mix(primary, '#ffffff', 0.86), muted: mix(primary, '#ffffff', 0.82),
    accent, onAccent: contrast(accent, '#ffffff') >= contrast(accent, DARK_TEXT) ? '#ffffff' : DARK_TEXT,
  }
}

/** A colour with transparency, for laying a brand shade over a photograph. */
export const withAlpha = (colour: string, alpha: number) => `rgba(${rgb(colour).join(', ')}, ${alpha})`
