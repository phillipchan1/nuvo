/**
 * Emit each legal/support route as real static HTML.
 *
 * Why: the site is a client-rendered SPA, so GET /privacy returns a shell with
 * an empty <div id="root">. Google's OAuth verification reviewers fetch that URL
 * to confirm the policy exists — as do crawlers that don't run JS. A policy that
 * only appears after hydration reads as a policy that isn't there.
 *
 * Runs after `vite build` (client) and `vite build --ssr` (server bundle).
 * Vercel checks the filesystem before applying rewrites, so dist/privacy/index.html
 * is served at /privacy and the SPA catch-all rewrite never sees it. React then
 * hydrates over the markup as usual.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')

const { render, PRERENDER_PATHS, ROUTES } = await import(
  pathToFileURL(resolve(root, 'dist-ssr/entry-server.js')).href
)

const shell = await readFile(resolve(dist, 'index.html'), 'utf8')

if (!shell.includes('<div id="root"></div>')) {
  throw new Error('prerender: could not find <div id="root"></div> in dist/index.html')
}

/** Content going into an HTML attribute — the copy contains apostrophes and
 *  quotes, and an unescaped one would truncate the tag. */
const attr = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Replace the value of a single-attribute tag already present in the shell,
 *  failing loudly rather than silently emitting the homepage's head. */
function swap(html, pattern, replacement, label) {
  if (!pattern.test(html)) throw new Error(`prerender: no ${label} tag found in dist/index.html`)
  return html.replace(pattern, replacement)
}

for (const path of PRERENDER_PATHS) {
  const head = ROUTES[path]
  if (!head) throw new Error(`prerender: no head data for "${path}"`)

  let html = shell.replace('<div id="root"></div>', `<div id="root">${render(path)}</div>`)

  html = swap(html, /<title>[\s\S]*?<\/title>/, `<title>${attr(head.title)}</title>`, 'title')
  html = swap(
    html,
    /<meta\s+name="description"[\s\S]*?\/>/,
    `<meta name="description" content="${attr(head.desc)}" />`,
    'description',
  )
  html = swap(
    html,
    /<link rel="canonical"[^>]*>/,
    `<link rel="canonical" href="${attr(head.canonical)}" />`,
    'canonical',
  )
  // og:url follows the canonical, or every share card claims to be the homepage.
  html = swap(
    html,
    /<meta property="og:url"[^>]*>/,
    `<meta property="og:url" content="${attr(head.canonical)}" />`,
    'og:url',
  )

  const out = resolve(dist, `.${path}/index.html`)
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, html, 'utf8')
  console.log(`prerendered ${path} → dist${path}/index.html`)
}
