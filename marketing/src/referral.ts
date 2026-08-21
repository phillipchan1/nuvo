/** Friend-code landing on the marketing site. Stash `?code=` and carry it
 *  onto Open-app links so the SPA can apply it at Checkout. Not an invite. */

const STORAGE_KEY = 'nuvo-referral-code'

export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20)
  return cleaned.length >= 2 ? cleaned : null
}

export function captureMarketingReferralCode(): string | null {
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('code') ?? params.get('ref')
  const code = normalizeCode(raw)
  if (!code) return readStoredCode()
  try {
    localStorage.setItem(STORAGE_KEY, code)
  } catch {
    /* ignore */
  }
  params.delete('code')
  params.delete('ref')
  const qs = params.toString()
  const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
  window.history.replaceState({}, '', next)
  return code
}

export function readStoredCode(): string | null {
  try {
    return normalizeCode(localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

/** Append `?code=` to the app URL when a friend code is pending. */
export function appUrlWithCode(base: string): string {
  const code = readStoredCode()
  if (!code) return base
  try {
    const u = new URL(base)
    u.searchParams.set('code', code)
    return u.toString()
  } catch {
    const join = base.includes('?') ? '&' : '?'
    return `${base}${join}code=${encodeURIComponent(code)}`
  }
}
