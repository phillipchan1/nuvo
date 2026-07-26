import { useEffect, useState } from 'react'
import Home from './Home'
import Privacy from './pages/Privacy'

function pathOf() {
  return window.location.pathname.replace(/\/+$/, '') || '/'
}

export default function App() {
  const [path, setPath] = useState(pathOf)

  useEffect(() => {
    const onNav = () => setPath(pathOf())
    window.addEventListener('popstate', onNav)
    return () => window.removeEventListener('popstate', onNav)
  }, [])

  useEffect(() => {
    if (path === '/privacy') {
      document.title = 'Privacy Policy — Nuvo'
    } else {
      document.title = 'Nuvo — One system for everything you run'
    }
    window.scrollTo(0, 0)
  }, [path])

  if (path === '/privacy') return <Privacy />
  return <Home />
}
