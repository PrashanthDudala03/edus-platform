// Run with `npm run test:unit` (Node's own test runner; no browser, no server, nothing to install).
import test from 'node:test'
import assert from 'node:assert/strict'
import { SECTION_HINTS, SECTION_LABELS, afterSignIn, eventDates, figure, move, setSkipSchoolHome, skipsSchoolHome } from '../src/pages/home/schoolHome.ts'

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
