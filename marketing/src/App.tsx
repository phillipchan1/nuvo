import { useEffect, useState } from 'react'
import Home from './Home'
import Privacy from './pages/Privacy'
import Support from './pages/Support'

function pathOf() {
  return window.location.pathname.replace(/\/+$/, '') || '/'
}

const HOME_TITLE = 'Nuvo — One system for everything you run'
const HOME_DESC =
  'For people running more than one life at once. Nuvo is one continuous system from the year you’re planning down to the hour you’re working — capture anything with ⌥Space on Mac, and land it on a real day.'

/** Per-route head. `canonical` matters: index.html hardcodes the homepage URL,
 *  so without this every route would tell search engines it *is* the homepage —
 *  which would keep the support page out of results entirely. */
const ROUTES: Record<string, { title: string; desc: string; canonical: string }> = {
  '/privacy': {
    title: 'Privacy Policy — Nuvo',
    desc: 'What Nuvo collects, why, and how your calendar data is handled.',
    canonical: 'https://nuvo.day/privacy',
  },
  '/support': {
    title: 'Support — Nuvo',
    desc: 'Guides, keyboard shortcuts, troubleshooting, billing, and how to reach a human. Everything you need to run Nuvo.',
    canonical: 'https://nuvo.day/support',
  },
}
// /help is the address people guess; serve the same page, canonical to /support.
ROUTES['/help'] = { ...ROUTES['/support'] }

function setMeta(selector: string, attr: 'content' | 'href', value: string) {
  document.querySelector(selector)?.setAttribute(attr, value)
}

export default function App() {
  const [path, setPath] = useState(pathOf)

  useEffect(() => {
    const onNav = () => setPath(pathOf())
    window.addEventListener('popstate', onNav)
    return () => window.removeEventListener('popstate', onNav)
  }, [])

  useEffect(() => {
    const route = ROUTES[path]
    document.title = route?.title ?? HOME_TITLE
    setMeta('meta[name="description"]', 'content', route?.desc ?? HOME_DESC)
    setMeta('link[rel="canonical"]', 'href', route?.canonical ?? 'https://nuvo.day/')
    // The browser resolves a hash before React has rendered the target, so a
    // deep link like /support#shortcuts would silently land at the top. Honor it
    // ourselves after paint; with no hash, reset to the top as usual.
    const hash = window.location.hash
    if (!hash) {
      window.scrollTo(0, 0)
      return
    }

    let cancelled = false
    const land = () => {
      if (cancelled) return
      // Only ever a same-document id — a hash from the address bar shouldn't be
      // able to become an arbitrary selector.
      if (!/^#[\w-]+$/.test(hash)) return
      // `behavior: 'instant'` overrides the global `scroll-behavior: smooth`.
      // That rule is for TOC clicks; on arrival a 5000px animation both reads as
      // a glitch and gets silently cancelled mid-load, landing you back at the top.
      document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'instant' })
    }
    // Once after paint, and again once the display fonts have swapped in — on a
    // page this long, Fraunces landing late shifts the target by hundreds of
    // pixels, so a single scroll lands you in the wrong section.
    const frame = requestAnimationFrame(land)
    document.fonts?.ready.then(land)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [path])

  if (path === '/privacy') return <Privacy />
  if (path === '/support' || path === '/help') return <Support />
  return <Home />
}
