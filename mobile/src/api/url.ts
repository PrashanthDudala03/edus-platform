/**
 * Checks the configured API address. Returns the cleaned address and, if it cannot be used, why.
 * Release builds must use HTTPS; plain HTTP is accepted only while developing.
 */
export function checkApiUrl(raw: string | undefined, development: boolean): { url: string, problem: string | null } {
  const url = (raw ?? '').trim().replace(/\/+$/, '')
  if (!url) return { url, problem: 'The EduOS address is not set. Add EXPO_PUBLIC_API_URL to mobile/.env.' }
  if (!/^https?:\/\/[^\s/]+/i.test(url)) return { url, problem: 'The EduOS address is not a valid web address.' }
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url)) return { url, problem: 'A phone cannot reach "localhost". Use an address the phone can open.' }
  if (!/^https:/i.test(url) && !development) return { url, problem: 'EduOS must be reached over HTTPS.' }
  return { url, problem: null }
}
