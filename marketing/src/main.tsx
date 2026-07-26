import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import App from './App'
import './index.css'

const root = document.getElementById('root')!
const tree = (
  <StrictMode>
    <App />
  </StrictMode>
)

// Legal + support routes ship as real HTML (scripts/prerender.mjs) so crawlers
// and Google's OAuth reviewers see the content without running JS. Adopt that
// markup instead of throwing it away and repainting.
if (root.firstChild) hydrateRoot(root, tree)
else createRoot(root).render(tree)
