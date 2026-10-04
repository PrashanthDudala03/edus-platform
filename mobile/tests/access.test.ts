import test from 'node:test'
import assert from 'node:assert/strict'
import { can, canOpen, experienceFor, navigationFor, tabsFor } from '../src/access/experience.ts'
import { deviceRegistration, isNotificationType, resolveNotificationRoute } from '../src/notifications/routes.ts'
import type { User } from '../src/session/types.ts'
import { brandTheme, contrast, withAlpha } from '../src/theme/brand.ts'
import { blocksOf, heroOf } from '../src/features/school-home/model.ts'
import { dayParts, dayRange, figure, initials, isoDay, isoMonth, lessonsByDay, percent, weekdayOf, type Lesson } from '../src/utils/format.ts'

const person = (dataScope: string, permissions: string[], roles = ['Custom role']): User => ({ id: 'u', username: 'u', email: '', firstName: 'A', lastName: 'B', schoolId: 's', roles, permissions, dataScope })
const parent = person('parent', ['reports.view', 'homework.view', 'timetable.view', 'fees.view', 'circulars.view', 'exams.view'])
const teacher = person('teacher', ['classes.view', 'timetable.view', 'attendance.view', 'attendance.mark', 'homework.view', 'exams.view', 'leave-requests.view', 'circulars.view'])
const student = person('student', ['timetable.view', 'homework.view', 'reports.view', 'exams.view', 'circulars.view'])
const leader = person('school', ['overview.view', 'attendance.view', 'exams.view', 'fees.view', 'leave-requests.view', 'timetable.view', 'circulars.view'], ['Administrator'])

test('the experience follows the data scope, not the role name', () => {
  assert.deepEqual([parent, teacher, student, leader].map(experienceFor), ['parent', 'teacher', 'student', 'principal'])
  assert.equal(experienceFor(person('school', [], ['Vice Principal'])), 'principal', 'a school-defined leadership role gets the leadership experience')
  assert.equal(experienceFor(person('teacher', [], ['Principal'])), 'teacher', 'a misleading role name does not widen the experience')
  for (const none of [person('platform', ['platform.manage'], ['SuperAdmin']), person('none', []), null, undefined]) assert.equal(experienceFor(none), null)
})

test('each role gets its agreed navigation, in order', () => {
  const labels = (user: User) => navigationFor(user).map(entry => entry.label)
  assert.deepEqual(labels(parent), ['Children', 'Homework', 'Notices', 'Timetable', 'Results', 'Fees', 'Exams', 'Student 360'])
  assert.deepEqual(labels(teacher), ['Classes', 'Attendance', 'Timetable', 'Homework', 'Exams', 'My leave', 'Notices'])
  assert.deepEqual(labels(student), ['Timetable', 'Homework', 'Results', 'Attendance', 'Exams', 'Notices', 'My school profile'])
  assert.deepEqual(labels(leader), ['Overview', 'Attendance', 'Leave', 'Timetable', 'Academics', 'Fees', 'Notices'])
  for (const user of [parent, teacher, student, leader]) assert.ok(navigationFor(user).every(entry => entry.route), 'every entry now opens a real screen')
})

test('an entry disappears when the account lacks its permission, and a role name alone grants nothing', () => {
  assert.deepEqual(navigationFor(person('parent', ['fees.view'])).map(e => e.key), ['fees'])
  assert.deepEqual(navigationFor(person('school', [], ['Administrator'])), [])
  assert.deepEqual(navigationFor(person('platform', ['overview.view'], ['SuperAdmin'])), [])
  assert.equal(can(leader, 'overview.view'), true)
  assert.equal(can(parent, 'overview.view'), false)
  assert.equal(can(null, 'overview.view'), false)
})

test('the bottom bar holds Home, at most three role screens, and Profile', () => {
  assert.deepEqual(tabsFor(parent).map(e => e.route), ['/children', '/homework', '/notices'])
  assert.deepEqual(tabsFor(teacher).map(e => e.route), ['/classes', '/register', '/timetable'])
  assert.deepEqual(tabsFor(student).map(e => e.route), ['/timetable', '/homework', '/results'])
  assert.deepEqual(tabsFor(leader).map(e => e.route), ['/overview', '/register', '/leave'])
  assert.deepEqual(tabsFor(person('parent', ['fees.view'])).map(e => e.route), [], 'a tab needs its permission like any other entry')
  for (const user of [parent, teacher, student, leader]) assert.ok(tabsFor(user).length <= 3)
})

test('a screen cannot be opened by an account with no entry for it', () => {
  assert.equal(canOpen(parent, '/children'), true)
  assert.equal(canOpen(student, '/children'), true, 'a student opens their own attendance on the same screen')
  assert.equal(canOpen(student, '/register'), false, 'only staff reach the register')
  assert.equal(canOpen(parent, '/leave'), false)
  assert.equal(canOpen(teacher, '/fees'), false)
  assert.equal(canOpen(person('teacher', ['classes.view']), '/register'), false, 'a teacher without attendance access')
  assert.equal(canOpen(parent, '/overview'), false)
  assert.equal(canOpen(person('school', []), '/overview'), false, 'leadership scope without the permission')
  assert.equal(canOpen(leader, '/overview'), true)
  for (const route of ['/home', '/profile', '/welcome'] as const) { assert.equal(canOpen(student, route), true); assert.equal(canOpen(null, route), false) }
})

test('a notification leads only where the signed-in account may go', () => {
  assert.deepEqual(resolveNotificationRoute({ type: 'attendance.absent', studentId: 'x' }, parent), { route: '/children', reason: 'opened' })
  assert.deepEqual(resolveNotificationRoute({ type: 'fee.due' }, teacher), { route: '/home', reason: 'not-allowed' })
  assert.deepEqual(resolveNotificationRoute({ type: 'leave.requested' }, leader), { route: '/leave', reason: 'opened' })
  assert.deepEqual(resolveNotificationRoute({ type: 'homework.assigned' }, student), { route: '/homework', reason: 'opened' })
  assert.deepEqual(resolveNotificationRoute({ type: 'timetable.changed' }, teacher), { route: '/timetable', reason: 'opened' })
  assert.deepEqual(resolveNotificationRoute({ type: 'substitution.assigned' }, teacher), { route: '/timetable', reason: 'opened' })
  assert.deepEqual(resolveNotificationRoute({ type: 'substitution.changed' }, leader), { route: '/timetable', reason: 'opened' })
  assert.deepEqual(resolveNotificationRoute({ type: 'school-home.published' }, leader), { route: '/welcome', reason: 'opened' })
  assert.deepEqual(resolveNotificationRoute({ type: 'something.new' }, parent), { route: '/home', reason: 'unknown-type' })
  assert.deepEqual(resolveNotificationRoute({ type: '__proto__' }, parent), { route: '/home', reason: 'unknown-type' })
})

test('a notification tapped while signed out goes to sign-in and remembers its destination', () => {
  assert.deepEqual(resolveNotificationRoute({ type: 'timetable.changed' }, null), { route: '/login', reason: 'signed-out', afterSignIn: '/timetable' })
  assert.deepEqual(resolveNotificationRoute({ type: 'nonsense' }, null), { route: '/login', reason: 'signed-out' })
  assert.equal(isNotificationType('fee.due'), true)
  assert.equal(isNotificationType('toString'), false)
})

test('device registration is a seam only: it does nothing yet and never throws', async () => {
  await deviceRegistration.register(parent)
  await deviceRegistration.unregister()
})

test('any school colour yields readable text, and bad colours fall back to EduOS', () => {
  for (const [primary, accent] of [['#1a5fb4', '#f5c211'], ['#2e7d32', '#f4ecd8'], ['#7a1f2b', '#d4a53a'], ['#ffe600', '#ffffff'], ['#f8f8f8', '#000000'], ['#000000', '#888888']]) {
    const theme = brandTheme({ primary, accent })
    assert.ok(contrast('#ffffff', theme.primary) >= 4.5, primary + ': white on primary')
    assert.ok(contrast('#ffffff', theme.deep) >= 7, primary + ': white on deep')
    assert.ok(contrast(theme.primary, theme.tint) >= 4.5, primary + ': primary on tint')
    assert.ok(contrast(theme.onAccent, theme.accent) >= 4.5, accent + ': text on accent')
    assert.equal(theme.accent, accent)
  }
  const fallback = brandTheme(null)
  for (const brand of [undefined, {}, { primary: '', accent: '' }, { primary: 'red', accent: '#12' }, { primary: 'url(x)', accent: '#gggggg' }]) assert.deepEqual(brandTheme(brand), fallback)
  assert.equal(withAlpha('#1f3a8a', 0.5), 'rgba(31, 58, 138, 0.5)')
})

test('School Home survives missing, empty and malformed sections', () => {
  for (const broken of [null, undefined, {}, { schoolName: 'X' }, { schoolName: 'X', sections: 'nope' }, { schoolName: 'X', sections: [null, 7, { key: 'gallery' }, { key: 'faculty', content: { items: 'nope' } }, { key: 'results', content: { toppers: [null, {}] } }, { key: 'unknown', content: {} }] }])
    assert.deepEqual(blocksOf(broken as never), [])
  assert.deepEqual(heroOf(null), { bannerId: '', bannerPosition: 'center', logoId: '', tagline: '', motto: '' })
  const home = { schoolName: 'Green Valley School', brand: null, sections: [
    { key: 'hero', content: { bannerId: 'b1', bannerPosition: 'sideways', logoId: 'l1', tagline: ' Learning with purpose ', motto: '' } },
    { key: 'identity', content: { motto: 'Knowledge and character', vision: '', mission: 'Teach well.' } },
    { key: 'statistics', content: { items: [{ label: 'Students', value: 1250 }, { label: '', value: '9' }, { label: 'Empty', value: '' }] } },
    { key: 'principal', content: { name: 'Dr. K', message: '', photoId: '' } },
    { key: 'events', content: { items: [{ title: 'Annual Day', startsOn: '2026-11-14', endsOn: '2026-11-15' }, { title: 'Bad date', startsOn: 'soon' }] } },
    { key: 'gallery', content: { items: [{ imageId: 'g1', caption: 'Sports day' }, { imageId: '' }] } },
  ] }
  assert.deepEqual(heroOf(home), { bannerId: 'b1', bannerPosition: 'center', logoId: 'l1', tagline: 'Learning with purpose', motto: 'Knowledge and character' })
  assert.deepEqual(blocksOf(home), [
    { key: 'identity', vision: '', mission: 'Teach well.' },
    { key: 'statistics', items: [{ label: 'Students', value: '1250' }] },
    { key: 'events', items: [{ title: 'Annual Day', startsOn: '2026-11-14', endsOn: '2026-11-15', description: '' }] },
    { key: 'gallery', items: [{ imageId: 'g1', caption: 'Sports day' }] },
  ])
})

test('dates, figures and the weekly timetable are formatted from what EduOS returned', () => {
  const day = new Date(2026, 9, 2)
  assert.deepEqual([isoDay(day), isoMonth(day), weekdayOf(day)], ['2026-10-02', '2026-10', 'Friday'])
  assert.equal(dayParts('2026-11-14')?.label, '14 Nov 2026')
  assert.equal(dayParts('2026-10-01T05:00:00Z')?.label, '1 Oct 2026')
  assert.equal(dayParts('soon'), null)
  assert.deepEqual([dayRange('2026-11-14', '2026-11-14'), dayRange('2026-11-14', '2026-11-16')], ['14 Nov 2026', '14 Nov 2026 – 16 Nov 2026'])
  assert.deepEqual([figure('1250'), figure('25+'), figure(84)], ['1,250', '25+', '84'])
  assert.deepEqual([percent(19, 20), percent(0, 0)], [95, null])
  assert.deepEqual([initials('Ravi Kumar'), initials('EduOS Demo School', 3), initials('')], ['RK', 'EDS', ''])
  const lesson = (id: string, weekday: string, startsAt: string): Lesson => ({ id, day: weekday, startsAt, endsAt: '', classId: '', subjectId: '', teacherId: '', room: '' })
  assert.deepEqual(lessonsByDay([lesson('c', 'Wednesday', '09:00'), lesson('b', 'Monday', '11:00'), lesson('a', 'Monday', '08:30')]).map(g => [g.day, g.lessons.map(l => l.id)]), [['Monday', ['a', 'b']], ['Wednesday', ['c']]])
})
