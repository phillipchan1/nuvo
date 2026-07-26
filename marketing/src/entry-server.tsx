/** SSR entry used only by the build-time prerenderer (scripts/prerender.mjs).
 *  It renders page components directly rather than <App />, because App reads
 *  window.location during render — there is no window here. */
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentType } from 'react'
import Privacy from './pages/Privacy'
import Support from './pages/Support'
import Terms from './pages/Terms'

const PAGES: Record<string, ComponentType> = {
  '/privacy': Privacy,
  '/terms': Terms,
  '/support': Support,
}

export function render(path: string): string {
  const Page = PAGES[path]
  if (!Page) throw new Error(`entry-server: no page registered for "${path}"`)
  return renderToStaticMarkup(<Page />)
}

export { PRERENDER_PATHS, ROUTES } from './routes'
