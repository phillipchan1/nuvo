import { useEffect, useState } from 'react'
import Home from './Home'
import Privacy from './pages/Privacy'
import Support from './pages/Support'
import Terms from './pages/Terms'
import { HOME_CANONICAL, HOME_DESC, HOME_TITLE, ROUTES } from './routes'

function pathOf() {
  return window.location.pathname.replace(/\/+$/, '') || '/'
}

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
    setMeta('link[rel="canonical"]', 'href', route?.canonical ?? HOME_CANONICAL)
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
  if (path === '/terms') return <Terms />
  if (path === '/support' || path === '/help') return <Support />
  return <Home />
}
