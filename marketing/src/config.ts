/** CTA targets — override via Vite env when deploying. */
export const APP_URL = (import.meta.env.VITE_APP_URL as string | undefined) || 'https://app.nuvo.app'
export const ACCESS_EMAIL =
  (import.meta.env.VITE_ACCESS_EMAIL as string | undefined) || 'hello@nuvo.app'
export const ACCESS_MAILTO = `mailto:${ACCESS_EMAIL}?subject=${encodeURIComponent('Nuvo access')}`

/** Same contact for privacy / legal (Google OAuth verification). */
export const PRIVACY_URL = 'https://nuvo.app/privacy'
