// School Home as EduOS returns it (GET /suite/home), turned into blocks the screen can draw without guarding every
// field. A school may publish any subset, and a section may be half filled in; nothing here may throw on that.
export interface HomeSection { key: string, content?: unknown }
export interface SchoolHome { schoolName: string, brand?: { primary?: string, accent?: string } | null, sections: HomeSection[] }
export interface SchoolHomeResponse { home: SchoolHome | null, canManage: boolean }

export interface Hero { bannerId: string, bannerPosition: string, logoId: string, tagline: string, motto: string }
export interface Person { name: string, department: string, designation: string, description: string, photoId: string, photoPosition: string }
export interface Achievement { title: string, description: string, category: string, imageId: string }
export interface SchoolEvent { title: string, startsOn: string, endsOn: string, description: string }
export interface Announcement { title: string, message: string, createdAt: string }
export interface Photo { imageId: string, caption: string }
export type Block =
  | { key: 'statistics', items: { label: string, value: string }[] }
  | { key: 'identity', vision: string, mission: string }
  | { key: 'principal', name: string, designation: string, message: string, photoId: string, photoPosition: string }
  | { key: 'results', academicYear: string, passPercentage: string, distinctions: string, ranks: { rank: string, name: string, detail: string }[] }
  | { key: 'faculty', items: Person[] }
  | { key: 'achievements', items: Achievement[] }
  | { key: 'events', items: SchoolEvent[] }
  | { key: 'announcements', items: Announcement[] }
  | { key: 'gallery', items: Photo[] }

type Row = Record<string, unknown>
const row = (value: unknown): Row => (value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {})
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '')
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.map(row) : [])
const POSITIONS = ['center', 'top', 'bottom', 'left', 'right']
const position = (value: unknown) => (POSITIONS.includes(text(value)) ? text(value) : 'center')
const content = (home: SchoolHome | null | undefined, key: string): Row => row(home?.sections?.find(section => section?.key === key)?.content)

/** The top of the page. Always usable: a school with no banner, logo or tagline still gets a hero with its name. */
export function heroOf(home: SchoolHome | null | undefined): Hero {
  const hero = content(home, 'hero')
  return { bannerId: text(hero.bannerId), bannerPosition: position(hero.bannerPosition), logoId: text(hero.logoId), tagline: text(hero.tagline), motto: text(hero.motto) || text(content(home, 'identity').motto) }
}

function block(section: HomeSection): Block | null {
  const c = row(section?.content), items = rows(c.items)
  switch (section?.key) {
    case 'statistics': { const list = items.map(i => ({ label: text(i.label), value: text(i.value) })).filter(i => i.label && i.value); return list.length ? { key: 'statistics', items: list } : null }
    case 'identity': { const vision = text(c.vision), mission = text(c.mission); return vision || mission ? { key: 'identity', vision, mission } : null }
    case 'principal': { const message = text(c.message), photoId = text(c.photoId); return message || photoId ? { key: 'principal', name: text(c.name), designation: text(c.designation), message, photoId, photoPosition: position(c.photoPosition) } : null }
    case 'results': {
      const ranks = rows(c.toppers).map(t => ({ rank: text(t.rank), name: text(t.name), detail: text(t.detail) })).filter(t => t.name)
      const passPercentage = text(c.passPercentage), distinctions = text(c.distinctions)
      return passPercentage || distinctions || ranks.length ? { key: 'results', academicYear: text(c.academicYear), passPercentage, distinctions, ranks } : null
    }
    case 'faculty': { const list = items.map(i => ({ name: text(i.name), department: text(i.department), designation: text(i.designation), description: text(i.description), photoId: text(i.photoId), photoPosition: position(i.photoPosition) })).filter(i => i.name); return list.length ? { key: 'faculty', items: list } : null }
    case 'achievements': { const list = items.map(i => ({ title: text(i.title), description: text(i.description), category: text(i.category), imageId: text(i.imageId) })).filter(i => i.title); return list.length ? { key: 'achievements', items: list } : null }
    case 'events': { const list = items.map(i => ({ title: text(i.title), startsOn: text(i.startsOn), endsOn: text(i.endsOn), description: text(i.description) })).filter(i => i.title && /^\d{4}-\d{2}-\d{2}$/.test(i.startsOn)); return list.length ? { key: 'events', items: list } : null }
    case 'announcements': { const list = items.map(i => ({ title: text(i.title), message: text(i.message), createdAt: text(i.createdAt) })).filter(i => i.title); return list.length ? { key: 'announcements', items: list } : null }
    case 'gallery': { const list = items.map(i => ({ imageId: text(i.imageId), caption: text(i.caption) })).filter(i => i.imageId); return list.length ? { key: 'gallery', items: list } : null }
    default: return null
  }
}
/** The sections worth drawing, in the school's own order. Empty, malformed or unknown sections are left out. */
export function blocksOf(home: SchoolHome | null | undefined): Block[] {
  return Array.isArray(home?.sections) ? home.sections.map(block).filter((b): b is Block => b !== null) : []
}
