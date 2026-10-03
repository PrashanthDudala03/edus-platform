// The schools EduOS lists when one sign-in name and password belong to several. Pure, so it is unit tested.
/** The schools a sign-in may choose between, when EduOS offers a choice. Anything malformed is dropped. */
export function schoolChoices(data: unknown): { id: string, name: string }[] {
  const list = (data as { schools?: unknown } | null | undefined)?.schools
  if (!Array.isArray(list)) return []
  return list.flatMap(item => {
    const id = (item as { id?: unknown } | null)?.id, name = (item as { name?: unknown } | null)?.name
    return typeof id === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) && typeof name === 'string' && name.trim() ? [{ id, name: name.trim() }] : []
  })
}
