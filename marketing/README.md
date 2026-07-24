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
| Domain | `nuvo.app` / `www` (product stays on `app.` or current host) |

Optional: Ignored Build Step so commits that only touch `src/` / `supabase/` skip this project, and vice versa.

## Design

Follow Warm Paper — see `../docs/design-language.md`. Prefer tokens from `../packages/design` once extracted; until then keep the marketing palette in lockstep with Daybreak light in `../src/index.css`.

## Content job

Paste [`HANDOFF.md`](./HANDOFF.md) into a new agent chat when building the page.
