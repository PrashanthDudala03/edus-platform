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
export type Draft = {
  sections: { key: SectionKey, visible: boolean }[]
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
export type HomeView = { schoolName: string, sections: { key: SectionKey, content: Record<string, any> }[] }

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
