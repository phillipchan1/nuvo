# Nuvo marketing site

Public one-pager for Nuvo. Separate Vite app, same monorepo as the product — so design and product truth stay close without sharing the SPA shell.

## Layout

```text
nuvo/
  src/ …              # product SPA (unchanged)
  marketing/          # this site → own Vercel project
  packages/design/    # shared tokens (stub; extract when ready)
  docs/design-language.md
```

## Local

```sh
cd marketing
npm install
npm run dev          # http://localhost:5174
```

## Deploy (Vercel)

Second Vercel project, same GitHub repo:

| Setting | Value |
|---------|--------|
| Root Directory | `marketing` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Domain | `nuvo.day` / `www` (product stays on `app.` or current host) |

Optional: Ignored Build Step so commits that only touch `src/` / `supabase/` skip this project, and vice versa.

## Design

Instrument (D-189), with one difference (D-195): headlines keep Fraunces; everything else — every product visual included — is Inter, as the app draws it. Grammar: `../docs/design-language.md`. Keep the tokens in `src/index.css` in lockstep with Light/Dark in `../src/index.css`. The mark is the app's `NuvoMark`, imported as `@nuvo/mark` — never redraw it. Regenerate the social image with `node og/render.cjs` while the dev server runs on 5174.

## Content job

Paste [`HANDOFF.md`](./HANDOFF.md) into a new agent chat when building the page.
