/** CTA targets — override via Vite env when deploying. */
export const APP_URL = (import.meta.env.VITE_APP_URL as string | undefined) || 'https://app.nuvo.day'
export const ACCESS_EMAIL =
  (import.meta.env.VITE_ACCESS_EMAIL as string | undefined) || 'hello@nuvo.day'
export const ACCESS_MAILTO = `mailto:${ACCESS_EMAIL}?subject=${encodeURIComponent('Nuvo access')}`

/** Support goes to the same inbox — one address is more honest than a fake
 *  support@ that routes to the same person. The subject is pre-filled so the
 *  inbox sorts itself. */
export const SUPPORT_EMAIL = ACCESS_EMAIL
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Nuvo support')}`
/** The reply window we publish. Only ever set this to something we can honor —
 *  a stated time we miss costs more trust than no stated time at all. */
export const SUPPORT_RESPONSE = 'Usually within one business day.'

/** Same contact for privacy / legal (Google OAuth verification). */
export const PRIVACY_URL = 'https://nuvo.day/privacy'
export const TERMS_URL = 'https://nuvo.day/terms'

/** Jurisdiction named in the Terms of Service. CHANGE THIS to where the
 *  business is actually established before the terms are relied on. */
export const GOVERNING_LAW = 'the State of California, United States'

/** Public releases repo that hosts the signed, notarized Mac builds + latest.json. */
export const RELEASES_REPO = 'phillipchan1/nuvo-releases'
/** Stable-named universal DMG — GitHub's `latest/download` alias always points at
 *  the newest release, so this static link never goes stale (no JS required). The
 *  hero button upgrades it to the exact asset URL on hover for an instant download. */
export const DOWNLOAD_MAC_URL = `https://github.com/${RELEASES_REPO}/releases/latest/download/Nuvo.dmg`
