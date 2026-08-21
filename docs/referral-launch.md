# Friend-codes launch — Grokbot checklist

**Read this first.** Full detail: [`billing-setup.md`](./billing-setup.md) §10. Product decision: D-113 / N-17.

## The offer

- **Friend:** 50% off first invoice  
- **Sharer:** one free month ($29 Stripe Customer Balance) when friend **pays** (not trial)  
- **Cap:** 6 months outstanding credit  
- **UX:** Settings → Billing shows the code. Marketing = Support FAQ only. No affiliates page.

## Do these in order

### 1. Create Stripe coupon + codes

```bash
cd <nuvo-repo>
STRIPE_SECRET_KEY=sk_live_… node scripts/create-referral-codes.mjs
```

Copy the printed `coup_…` id and the four texts (PHIL / ESTHER / DAVID / CHUNG).

### 2. Supabase secret

```bash
supabase secrets set STRIPE_REFERRAL_COUPON=coup_… --project-ref ebibzojtkzkphykznomv
```

### 3. Migrations (if not applied)

```bash
supabase db push --project-ref ebibzojtkzkphykznomv
```

Needs `66_referral_codes` and `67_referral_reward`.

### 4. Deploy functions

```bash
supabase functions deploy stripe-checkout stripe-webhook referral-code --project-ref ebibzojtkzkphykznomv
```

### 5. Webhook event

Stripe Dashboard → Developers → Webhooks → Nuvo endpoint → ensure **`invoice.paid`** is enabled (plus the existing checkout/subscription/payment_failed events).

### 6. Notify betas (optional)

Paste texts from the script output, **or** tell them: open Nuvo → Settings → Billing → Share Nuvo.

### 7. Done — hands-off

New accounts get a code automatically when they open Billing. Do not create an apply form, partner portal, or spreadsheet workflow.

## Verify

| Check | How |
|---|---|
| Code shows in Billing | Logged-in → Settings → Billing |
| Friend discount | `nuvo.day/?code=PHIL` → subscribe → first invoice ~50% |
| Sharer credit | After friend pays, Phil's Stripe customer has −$29 balance |
| Cap | Six outstanding months of credit → further rewards skipped (logged) |

## Do not

- Build `/affiliates` or a leaderboard  
- Credit on trial start  
- Pay cash / Connect / commissions  
- Fold marketing into the SPA  
