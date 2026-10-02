import type { User } from '../../store/auth'

// School Home: the shapes shared by the page and its editor, and the rule for where sign-in leads.
// Presentation only. The API decides what each reader may see and who may edit.
export type SectionKey = 'hero' | 'identity' | 'principal' | 'results' | 'statistics' | 'faculty' | 'achievements' | 'events' | 'announcements' | 'gallery'
export const SECTION_LABELS: Record<SectionKey, string> = {
  hero: 'Hero', identity: 'Motto, vision & mission', principal: 'Principal message', results: 'Previous year results', statistics: 'School statistics',
  faculty: 'Featured faculty', achievements: 'Achievements', events: 'Upcoming events', announcements: 'Announcements', gallery: 'Gallery',
}
export const SECTION_HINTS: Record<SectionKey, string> = {
  hero: 'Banner, logo and tagline at the top of the page', identity: 'What your school stands for', principal: 'A personal welcome from the principal',
  results: 'Headline figures from the last academic year', statistics: 'A few numbers that describe your school', faculty: 'People you choose to introduce',
  achievements: 'Academic, sports and cultural highlights', events: 'Dates from the school calendar', announcements: 'The latest circulars', gallery: 'A small, chosen set of photographs',
}
export const POSITIONS = ['center', 'top', 'bottom', 'left', 'right'] as const
export const CATEGORIES = ['Academic', 'Sports', 'Cultural', 'Other'] as const
export const STAT_SOURCES: [string, string][] = [['students', 'Students on roll (live count)'], ['teachers', 'Teaching staff (live count)'], ['custom', 'Your own value']]

export type Topper = { rank: string, name: string, detail: string }
export type Statistic = { label: string, source: string, value: string }
export type Faculty = { teacherId: string, designation: string, description: string, photoId: string, photoPosition: string, visible: boolean }
export type Achievement = { title: string, description: string, category: string, imageId: string }
export type Photo = { imageId: string, caption: string }
/** The school's two brand colours as #rrggbb; blank means the EduOS palette. */
export type Brand = { primary: string, accent: string }
export type Draft = {
  sections: { key: SectionKey, visible: boolean }[]
  brand?: Brand
  hero: { tagline: string, bannerId: string, bannerPosition: string, logoId: string }
  identity: { motto: string, vision: string, mission: string }
  principal: { name: string, designation: string, message: string, photoId: string, photoPosition: string }
  results: { academicYear: string, passPercentage: string, distinctions: string, toppers: Topper[] }
  statistics: { items: Statistic[] }
  faculty: { items: Faculty[] }
  achievements: { items: Achievement[] }
  events: { count: number }
  announcements: { count: number }
  gallery: { items: Photo[] }
}
/** What a reader receives: visible, non-empty sections in the school's order, with live data already resolved. */
export type HomeView = { schoolName: string, brand?: Brand | null, sections: { key: SectionKey, content: Record<string, any> }[] }

// School branding: two configured colours become a small set of shades that always keep text readable.
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
export const DEFAULT_BRAND: Brand = { primary: '#167865', accent: '#89c6b3' }
/** CSS variables for the welcome page. A missing or malformed colour falls back to the EduOS palette. */
export function brandTheme(brand?: Partial<Brand> | null): Record<string, string> {
  const primary = readable(HEX.test(brand?.primary || '') ? brand!.primary! : DEFAULT_BRAND.primary)
  const accent = HEX.test(brand?.accent || '') ? brand!.accent!.toLowerCase() : DEFAULT_BRAND.accent, deep = mix(primary, '#000000', 0.45)
  return {
    '--sw-primary': primary, '--sw-deep': deep, '--sw-deep-rgb': rgb(deep).join(','), '--sw-tint': mix(primary, '#ffffff', 0.94), '--sw-soft': mix(primary, '#ffffff', 0.86),
    '--sw-muted': mix(primary, '#ffffff', 0.82), '--sw-accent': accent, '--sw-on-accent': contrast(accent, '#ffffff') >= contrast(accent, '#14211c') ? '#ffffff' : '#14211c',
  }
}
/** The first letters of a name, for a monogram where there is no logo or photograph. */
export const initials = (name: string, most: number) => String(name).split(/\s+/).filter(word => /^[\p{L}\p{N}]/u.test(word)).slice(0, most).map(word => word[0].toUpperCase()).join('')
export const greeting = (hour: number) => hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

export function move<T>(items: T[], index: number, by: -1 | 1): T[] {
  const to = index + by
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return items
  const next = [...items]
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}

// The skip choice is a convenience kept on this device for this account; it changes no access.
const skipKey = (user: Pick<User, 'id'>) => 'eduos.skipSchoolHome.' + user.id
export function skipsSchoolHome(user: Pick<User, 'id'> | null | undefined, storage: Pick<Storage, 'getItem'> = localStorage) {
  try { return !!user && storage.getItem(skipKey(user)) === '1' } catch { return false }
}
export function setSkipSchoolHome(user: Pick<User, 'id'>, skip: boolean, storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage) {
  try { if (skip) storage.setItem(skipKey(user), '1'); else storage.removeItem(skipKey(user)) } catch { /* storage is unavailable; the page is simply shown again */ }
}
/** After sign-in a school user sees School Home first. The platform administrator, and anyone who chose to skip, go straight to the dashboard. */
export function afterSignIn(user: Pick<User, 'dataScope'>, dashboard: string, skipped: boolean) {
  return user.dataScope === 'platform' || skipped ? dashboard : '/home'
}

const day = (value: string) => new Date(value + 'T00:00:00')
export function eventDates(startsOn: string, endsOn: string, locale = 'en-IN') {
  const format = (value: string) => day(value).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
  return !endsOn || endsOn === startsOn ? format(startsOn) : format(startsOn) + ' – ' + format(endsOn)
}
export const figure = (value: string) => /^\d+(\.\d+)?$/.test(value) ? Number(value).toLocaleString('en-IN') : value
