# Web hosting on Cloudflare (moved off Vercel 2026-11-06)

**Status:** live since 2026-11-06 ~11:50 PT. Hosting only. The app still talks to
Supabase directly. This is **not** the Supabase → Neon/Better Auth cutover in
[`cloudflare-cutover.md`](./cloudflare-cutover.md), which is unchanged and not flipped.

| Host | Worker | Config | Serves |
|---|---|---|---|
| app.nuvo.day | `nuvo-app` | `wrangler.app.jsonc` | `dist/` (Vite SPA + PWA), SPA fallback |
| nuvo.day, www.nuvo.day | `nuvo-site` | `marketing/wrangler.jsonc` | `marketing/dist/` (prerendered), `drop-trailing-slash`, SPA fallback |
| api.nuvo.day | `nuvo` | `wrangler.jsonc` | **untouched** by this move |

Both are assets-only Workers: there's no Worker code and no bindings, crons or queues.
Headers come from `public/_headers` and `marketing/public/_headers`: HSTS 2y, as Vercel
sent, plus the `sw.js` and manifest headers from `vercel.json`. A zone redirect
rule 308s `http://` → `https://` for these three hosts only, as Vercel did.

Previews: `--env preview` → `nuvo-app-preview` / `nuvo-site-preview` on
`*.nq-morning-briefing.workers.dev`, with no custom domains. They use the same
production Supabase project and public keys as Vercel previews did. The SPA has no
jobs or webhooks. Google sign-in on the preview falls back to app.nuvo.day until
the preview origin is added to Supabase Auth → URL Configuration.

## Deploys

`.github/workflows/cloudflare-hosting.yml`:
- push to master → production
- PR → preview
- workflow_dispatch → production

It needs the repo secrets `CLOUDFLARE_API_TOKEN` (the "Edit Cloudflare Workers" template)
and `VITE_VAPID_PUBLIC_KEY`, plus the `VITE_*` secrets release.yml already uses.
Manual deploy:

    npm run build:web && npx wrangler deploy -c wrangler.app.jsonc
    (cd marketing && npm run build) && npx wrangler deploy -c marketing/wrangler.jsonc

Never run a bare `wrangler deploy` at the repo root for the web app: that is the API Worker.

The local `npm run build:web` with production public env was byte-identical to Vercel's
production bundle at 02bca99 (all 93 chunks, `sw.js`, manifest, every marketing page).

## Rollback (≈1 min, dashboard → nuvo.day → DNS)

1. Workers & Pages → `nuvo-app` / `nuvo-site` → Settings → Domains → remove the custom domain.
2. Re-create the DNS records (DNS only, TTL auto):
   - `A nuvo.day 216.150.1.1`
   - `CNAME www cname.vercel-dns.com`
   - `CNAME app cname.vercel-dns.com`
3. Vercel projects `nuvo` / `nuvo-site` still have the domains attached and keep building
   from master. The last pre-move production deployments were
   `dpl_7pRDXxKy8FLwoCDJvYhK3dz1CUV5` (nuvo) and `dpl_CaEkUonCtCMf5vnpjuCP83XgJ73i`
   (nuvo-site).

Untouched in the move: the Resend records (`send` / `rsend` / DKIM under `inbox`), the SES MX on
`inbox`, the google-site-verification TXT record, and `api` (the Worker `nuvo`).
