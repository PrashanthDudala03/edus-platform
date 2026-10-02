// Run with `npm run test:unit` (Node's own test runner; no browser, no server, nothing to install).
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_BRAND, SECTION_HINTS, SECTION_LABELS, afterSignIn, brandTheme, contrast, eventDates, figure, greeting, move, setSkipSchoolHome, skipsSchoolHome } from '../src/pages/home/schoolHome.ts'

test('any school colour yields a readable page', () => {
  // Blue and gold, green and cream, maroon and gold, then colours that are far too light or too dark to use as they are.
  for (const [primary, accent] of [['#1a5fb4', '#f5c211'], ['#2e7d32', '#f4ecd8'], ['#7a1f2b', '#d4a53a'], ['#ffe600', '#ffffff'], ['#f8f8f8', '#000000'], ['#000000', '#888888']]) {
    const theme = brandTheme({ primary, accent }), on = (text: string, surface: string) => contrast(text, surface)
    assert.ok(on('#ffffff', theme['--sw-primary']) >= 4.5, primary + ': white text on the primary band')
    assert.ok(on('#ffffff', theme['--sw-deep']) >= 7, primary + ': white text on the deep band')
    assert.ok(on(theme['--sw-primary'], '#ffffff') >= 4.5, primary + ': primary text on white')
    assert.ok(on(theme['--sw-primary'], theme['--sw-tint']) >= 4.5, primary + ': primary text on the tinted section')
    assert.ok(on(theme['--sw-deep'], theme['--sw-soft']) >= 4.5, primary + ': deep text on a soft chip')
    assert.ok(on(theme['--sw-on-accent'], theme['--sw-accent']) >= 4.5, accent + ': button text on the accent')
    assert.equal(theme['--sw-accent'], accent)
  }
})

test('missing or malformed colours fall back to the EduOS palette', () => {
  const fallback = brandTheme(null)
  for (const brand of [undefined, {}, { primary: '', accent: '' }, { primary: 'red', accent: '#12' }, { primary: 'url(x)', accent: '#gggggg' }]) assert.deepEqual(brandTheme(brand), fallback)
  assert.equal(fallback['--sw-accent'], DEFAULT_BRAND.accent)
  assert.ok(contrast('#ffffff', fallback['--sw-primary']) >= 4.5)
})

test('the greeting follows the time of day', () => {
  assert.deepEqual([0, 11, 12, 16, 17, 23].map(greeting), ['Good morning', 'Good morning', 'Good afternoon', 'Good afternoon', 'Good evening', 'Good evening'])
})

function storage() {
  const values = new Map<string, string>()
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
}

test('a school user goes to School Home after sign-in, whatever the role', () => {
  for (const dataScope of ['school', 'teacher', 'parent', 'student']) assert.equal(afterSignIn({ dataScope }, '/teacher', false), '/home')
})

test('the platform administrator keeps going straight to the platform dashboard', () => {
  assert.equal(afterSignIn({ dataScope: 'platform' }, '/super-admin', false), '/super-admin')
})

test('someone who chose to skip School Home goes straight to their dashboard', () => {
  assert.equal(afterSignIn({ dataScope: 'parent' }, '/parent', true), '/parent')
})

test('the skip choice is kept per account and can be undone', () => {
  const store = storage(), asha = { id: 'user-asha' }, ravi = { id: 'user-ravi' }
  assert.equal(skipsSchoolHome(asha, store), false)
  setSkipSchoolHome(asha, true, store)
  assert.equal(skipsSchoolHome(asha, store), true)
  assert.equal(skipsSchoolHome(ravi, store), false)
  assert.equal(skipsSchoolHome(null, store), false)
  setSkipSchoolHome(asha, false, store)
  assert.equal(skipsSchoolHome(asha, store), false)
  assert.equal(store.values.size, 0)
})

test('blocked browser storage never stops sign-in', () => {
  const blocked = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') }, removeItem: () => { throw new Error('denied') } }
  assert.equal(skipsSchoolHome({ id: 'user-asha' }, blocked), false)
  assert.doesNotThrow(() => setSkipSchoolHome({ id: 'user-asha' }, true, blocked))
})

test('reordering moves one step and leaves the list alone at either end', () => {
  const sections = ['hero', 'identity', 'gallery']
  assert.deepEqual(move(sections, 0, 1), ['identity', 'hero', 'gallery'])
  assert.deepEqual(move(sections, 2, -1), ['hero', 'gallery', 'identity'])
  assert.equal(move(sections, 0, -1), sections)
  assert.equal(move(sections, 2, 1), sections)
  assert.deepEqual(sections, ['hero', 'identity', 'gallery'])
})

test('every section has a label and a hint', () => {
  assert.equal(Object.keys(SECTION_LABELS).length, 10)
  assert.deepEqual(Object.keys(SECTION_HINTS).sort(), Object.keys(SECTION_LABELS).sort())
})

test('event dates show one day or a range', () => {
  assert.equal(eventDates('2026-11-14', '2026-11-14', 'en-GB'), '14 Nov 2026')
  assert.equal(eventDates('2026-11-14', '2026-11-16', 'en-GB'), '14 Nov 2026 – 16 Nov 2026')
})

test('only plain numbers are formatted; a typed value is shown as written', () => {
  assert.equal(figure('1250'), '1,250')
  assert.equal(figure('25+'), '25+')
  assert.equal(figure('Since 1998'), 'Since 1998')
})
