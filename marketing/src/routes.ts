/** Route head data, shared by the client shell (App.tsx) and the prerenderer
 *  (scripts/prerender.mjs via entry-server.tsx) so the two can never drift.
 *
 *  Prerendering exists for a specific reason: this is a client-rendered SPA, so
 *  a fetch of /privacy returns the empty shell. Google's OAuth reviewers — and
 *  any crawler that doesn't run JS — would see a privacy policy that isn't
 *  there. Every legal route must ship as real HTML. */

export const HOME_TITLE = 'Nuvo — One system for everything you run'
export const HOME_DESC =
  'For people running more than one life at once. Nuvo is one continuous system from the year you’re planning down to the hour you’re working — capture anything with ⌥Space on Mac, and land it on a real day.'
export const HOME_CANONICAL = 'https://nuvo.day/'

export type RouteHead = { title: string; desc: string; canonical: string }

/** `canonical` matters: index.html hardcodes the homepage URL, so without this
 *  every route would tell search engines it *is* the homepage — which would keep
 *  the support page out of results entirely. */
export const ROUTES: Record<string, RouteHead> = {
  '/': {
    title: HOME_TITLE,
    desc: HOME_DESC,
    canonical: HOME_CANONICAL,
  },
  '/privacy': {
    title: 'Privacy Policy — Nuvo',
    desc: 'What Nuvo collects, why, and how your calendar data is handled.',
    canonical: 'https://nuvo.day/privacy',
  },
  '/terms': {
    title: 'Terms of Service — Nuvo',
    desc: 'The agreement covering your Nuvo account, subscription, connected calendars, and content.',
    canonical: 'https://nuvo.day/terms',
  },
  '/support': {
    title: 'Support — Nuvo',
    desc: 'Guides, keyboard shortcuts, troubleshooting, billing, and how to reach a human. Everything you need to run Nuvo.',
    canonical: 'https://nuvo.day/support',
  },
}

// /help is the address people guess; serve the same page, canonical to /support.
ROUTES['/help'] = { ...ROUTES['/support'] }

/** Routes emitted as static HTML at build time. /help is deliberately absent —
 *  it's an alias, and prerendering it would publish a second copy of the same
 *  page; the SPA rewrite still serves it. The home page is included: Google's
 *  OAuth branding reviewer fetches "/" without running JS, and an un-prerendered
 *  SPA shell there reads as "the home page does not explain the app's purpose"
 *  and "the app name doesn't match" — there is no name or copy to find. */
export const PRERENDER_PATHS = ['/', '/privacy', '/terms', '/support']
