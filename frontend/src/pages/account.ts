// How the signed-in person is named in the header and on My account. Pure, so it is unit tested.
type Person = { firstName?: string, lastName?: string, username?: string, roles?: string[], dataScope?: string }

/** The person's name as shown: first and last name, or the sign-in name when no name is recorded. */
export const accountName = (user: Person | null | undefined) => [user?.firstName, user?.lastName].map(part => (part || '').trim()).filter(Boolean).join(' ') || user?.username || 'Account'
/** Up to two initials for the avatar. */
export function accountInitials(user: Person | null | undefined): string {
  const parts = [user?.firstName, user?.lastName].map(part => (part || '').trim()).filter(Boolean)
  return ((parts.length ? parts : [user?.username || 'A']).map(part => [...part][0]).join('').slice(0, 2) || 'A').toUpperCase()
}
/** The account type shown under the name: the role names, never an internal scope or id. */
export const accountKind = (user: Person | null | undefined) => (user?.roles || []).filter(Boolean).join(' · ') || (user?.dataScope === 'platform' ? 'Platform' : 'Staff')
/** Where the header identity leads. Platform accounts live under /super-admin; everyone else under /account. */
export const accountPath = (user: Person | null | undefined) => user?.dataScope === 'platform' ? '/super-admin/account' : '/account'
