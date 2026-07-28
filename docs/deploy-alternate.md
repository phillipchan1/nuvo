# Deploying somewhere other than Vercel

**Production is Vercel.** `app.nuvo.day` is the real deployment, `vercel.json` is the
real config, and everything in `CLAUDE.md` § "Build, verify, deploy" still holds. This
page covers one exception: a network that blocks `*.vercel.app` (corporate proxies
category-block the shared free subdomains of every PaaS, Vercel's included), so the app
needs a second reachable origin.

Nuvo's frontend is a **pure static SPA** — `npm run build:web` emits `dist/`, no server
runtime, no SSR, no serverless functions. The backend is Supabase on its own origin. So
"deploy somewhere else" is only ever: build the same bundle, serve it as static files
with an SPA fallback. Any static host can do it. Running two at once is fine — both read
the same Supabase project, so it's one account and one dataset seen through two URLs.

## What's already wired

| File | Host | Mirrors |
| --- | --- | --- |
| `vercel.json` | Vercel (production) | — |
| `netlify.toml` | Netlify | build command + publish dir |
| `public/_redirects` | Cloudflare Pages · Netlify | `vercel.json` → `rewrites` |
| `public/_headers` | Cloudflare Pages · Netlify | `vercel.json` → `headers` |

`public/_redirects` and `public/_headers` are copied into `dist/`, so Vercel serves them
too — as two inert text files it ignores. They contain no secrets.

## Recommended: Cloudflare Pages

Closest thing to the Vercel experience — git-connected, builds on every push to the
branch you pick, preview URL per branch, free HTTPS, custom domains — and `*.pages.dev`
is the shared subdomain least often caught by corporate blocklists.

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to
   Git** → the `nuvo` repo.
2. Build command `npm run build:web`, output directory `dist`, framework preset **None**
   (the preset would override the command).
3. Environment variables — **required, the build silently produces a dead app without
   them**: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, same values as Vercel. They
   are baked in at build time and are safe to embed (see `CLAUDE.md`).
4. Deploy → you get `https://<project>.pages.dev`.

Netlify is the same shape (`netlify.toml` already sets the build for you) if Pages is
blocked too, but `*.netlify.app` gets category-blocked at roughly the Vercel rate, so
try Pages first.

**If the free subdomain is also blocked**, stop fighting the blocklist: point a
subdomain you already own at the alternate host — `alt.nuvo.day`, CNAME to the
`pages.dev` target, HTTPS provisions automatically. Blocklists target the shared
subdomains, not domains with a real owner, so this is the reliable fix rather than the
lucky one. It costs one DNS record and doesn't touch the Vercel deployment.

## The one step that isn't optional

**Add the new origin to Supabase → Authentication → URL Configuration → Redirect URLs**
(`https://<project>.pages.dev/**`).

This is the whole difference between working and mysteriously broken. `src/lib/googleAuth.ts`
sends `redirectTo: window.location.origin`, and an unlisted value is **not an error** —
Supabase quietly falls back to the project's Site URL, so signing in on the new host
bounces you to `app.nuvo.day` (still blocked) and the new origin never gets a session.
The same footgun is documented in that file's header comment for the Tauri shell.

Leave **Site URL** pointed at the Vercel production URL. Only add to the allow-list.

Also check Google Cloud Console → the OAuth client's **Authorized redirect URIs** if
sign-in still fails — though that list holds the Supabase callback
(`https://<ref>.supabase.co/auth/v1/callback`), not app origins, so it usually needs no
change.

## Sanity check — is it the same experience as Vercel?

The bundle is byte-identical to Vercel's, so what can differ is only routing, headers and
auth. Five things, ~2 minutes, on the work laptop:

1. **Deep link / hard refresh** — load the URL, then reload. Serves the app, not a 404.
   (Proves `_redirects`.)
2. **Sign in with Google** — completes and lands back on the *new* origin, still signed
   in. If it dumps you on `app.nuvo.day`, the redirect allow-list step above was missed.
3. **Real data renders** — the Schedule shows actual tasks/events, not an empty shell.
   (Proves the two `VITE_SUPABASE_*` vars reached the build.)
4. **PWA install** — Share → Add to Home Screen, launch it standalone. Needs HTTPS,
   which the host provides.
5. **Service worker freshness** — DevTools → Network → `sw.js` returns
   `Cache-Control: public, max-age=0, must-revalidate`. (Proves `_headers`; without it
   an installed PWA can pin to a stale build.)

Locally, `npm run build:web && npx serve -s dist` approximates 1 and 5 before you push.

## Notes

- **Two PWA installs are two installs.** iOS scopes a home-screen app to its origin, so
  the `pages.dev` one is separate from the `app.nuvo.day` one — separate service worker,
  separate session, both talking to the same Supabase account. Sign in once on each.
- **Nothing here touches the desktop app.** Tauri bundles `dist/` locally and updates via
  `latest.json` in `phillipchan1/nuvo-releases`; it never fetches a hosted origin.
- **`marketing/` is a separate Vite app and a separate Vercel project** (D-018). This page
  is about the app only.
- **Turn it off when the block lifts** — delete the Pages project and drop the redirect
  URL from Supabase. One production host is the standing rule; this is the exception.
