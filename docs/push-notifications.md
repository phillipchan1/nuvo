# Background reminders — how they work, and how to turn them on

**Status:** live — VAPID secrets set and verified 2026-08-13. Untested against a
real device; see §4's checklist and §6.
**Decisions:** [D-102](./product/decisions.md) (what may be said) ·
[D-105](./product/decisions.md) (push is allowed with consent)
**Rules:** [`_shared/reminderRules.ts`](../supabase/functions/_shared/reminderRules.ts)

Reminders used to fire only while Nuvo was open. They can now reach a closed
app. This is the mechanism, the trade it takes, and the five commands that make
it live.

---

## 1 · The thing that is actually hard

One person, several places a reminder could come from:

```
  Mac app, open ─┐
  phone, asleep ─┤
  browser tab   ─┼──▶  "Standup in 10 minutes"
  cron dispatch ─┘
```

Naively that is four notifications for one meeting. Being told four times is not
four times as useful — it is the notification theater Principle 9 refuses,
arriving by accident rather than by design.

**So nothing speaks without claiming first.**

`claim_reminder(key, fire_at)` is an atomic insert against a unique key of
`(user, reminder, fire instant)`. Exactly one caller wins; the rest find out
immediately and stay quiet. The unit is the **person**, not the device — which
is the whole point.

Two properties make that work, and both are load-bearing:

- **Both sides compute the same key.** The app and the dispatcher build anchors
  from [`_shared/reminderAnchors.ts`](../supabase/functions/_shared/reminderAnchors.ts)
  and fire instants from `reminderRules.ts`. Two implementations disagreeing by
  one second would both "win". This is the same law as the planning kernel, for
  the same reason. `tests/push-reconciliation.test.ts` pins it.
- **An open app wins.** The dispatcher subtracts `DISPATCH_LAG_MS` (30s) before
  asking what is due, so a foreground client — which fires within a second —
  claims first. Someone sitting in front of Nuvo gets the in-app notification
  and **no push at all**.

If the claim can't be reached (offline, or the migration hasn't landed), the
client shows the reminder anyway. Silence about a meeting starting in ten
minutes is a worse failure than the same meeting announced twice.

---

## 2 · Where it reaches

| Surface | Background delivery | How |
|---|---|---|
| **Installed iOS PWA** | ✅ iOS 16.4+ | Web Push → service worker. **Only when added to the Home Screen** — Safari in a tab cannot subscribe. |
| **Desktop browsers** | ✅ | Web Push → service worker. |
| **Tauri macOS app** | ⚠️ while running | No service worker by design (custom protocol, and Tauri owns its updater). It shows reminders in-app whenever the process is alive, which for a desktop app is most of the working day. |
| **Tauri iOS app** | ❌ | Same — no service worker. True quit-state delivery here needs **APNs** and a native plugin, which is a different piece of work (§6). |

The honest read: **the phone PWA is what background push is for.** The Mac app is
usually running, and when it is, it is the one that claims and speaks.

Settings → Reminders says which of these applies, in words, rather than implying
it works everywhere.

---

## 3 · The parts

| File | What it does |
|---|---|
| `supabase/migrations/…61_push_delivery.sql` | `push_subscriptions`, `reminder_deliveries`, `claim_reminder()`, `user_settings.time_zone`, the cron entries |
| `_shared/reminderAnchors.ts` | the shared anchor builder — one implementation, both runtimes |
| `_shared/webpush.ts` | VAPID (RFC 8292) + aes128gcm encryption (RFC 8291) on Deno's WebCrypto |
| `supabase/functions/push-dispatch/` | the every-minute dispatcher |
| `src/sw.ts` | the service worker's `push` + `notificationclick` |
| `src/lib/push.ts` | subscribe / unsubscribe / status |
| `src/hooks/useReminders.ts` | claim-before-show, and keeping the subscription in step with the toggle |

Two things that are **not** in the outbox, deliberately:
`push_subscriptions` (minted by a live registration that exists on one device —
a queued one would name an endpoint that was never created) and
`reminder_deliveries` (a claim is worthless if it can be replayed hours later).

---

## 4 · Turning it on

Five commands. Nothing here is reversible-by-accident; the app runs fine without
any of it, with reminders staying foreground-only.

```bash
npx web-push generate-vapid-keys
```

That prints a public and a private key. Then:

```bash
supabase secrets set VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> VAPID_SUBJECT=mailto:you@yourdomain.com
```

The **public** key also has to reach the browser at build time, so add it to
`.env.local` and to Vercel's environment:

```bash
echo 'VITE_VAPID_PUBLIC_KEY=<public>' >> .env.local
```

Then apply and deploy:

```bash
supabase db push
```

```bash
supabase functions deploy push-dispatch
```

**The private key never goes in the repo, in `.env.local`, or in the browser.**
It lives only in Supabase secrets — the same rule as the Tauri updater key.

### Checking the setup before you test on a phone

Two questions the CLI can't answer — the secrets live only in the function's
environment, so the function is the only thing that can say. Ask it:

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/push-dispatch" -H "Authorization: Bearer $SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d "{\"selfTest\":true,\"clientPublicKey\":\"$VITE_VAPID_PUBLIC_KEY\"}"
```

`{"ok":true,"matchesClient":true}` means both of the things that usually go
wrong are fine:

- **`ok`** — the pair genuinely signs. It imports the private key as a JWK using
  the public key's x/y coordinates, so a public and private key from two
  *different* `generate-vapid-keys` runs fail here rather than 403-ing at 8:50am
  when a reminder doesn't arrive.
- **`matchesClient`** — the key baked into the browser bundle is the same one the
  server signs with. A public key is shipped in every bundle by design, so
  comparing it discloses nothing.

`matchesClient: false` after a Vercel deploy almost always means Vercel's
`VITE_VAPID_PUBLIC_KEY` is stale — rebuild after changing it.

### Checking it worked

1. Open the deployed app **on a phone, installed to the Home Screen**.
2. Settings → Reminders → on → allow notifications. The "When Nuvo is closed" row
   should read *"This device will be told even when Nuvo is closed."*
3. Schedule a task 6 minutes out, close the app completely, wait.
4. If nothing arrives: `supabase functions logs push-dispatch`, and check
   `select * from push_subscriptions` has a row.

---

## 5 · What it is allowed to say

Unchanged by any of this, and the reason the kernel has the shape it has:

> Three anchors. A meeting starting, a block you scheduled starting, a deadline
> arriving. Never a planning nudge, never a count, never a streak.

Consent does not widen that. A user who says yes to reminders has agreed to hear
that a meeting starts in ten minutes; they have not agreed to hear that they
have four overdue tasks. `reminderRules.ts` structurally cannot express the
second — it takes an anchor instant and a lead and has no other input — and
`tests/push-reconciliation.test.ts` fails if the dispatcher ever reaches for
one.

---

## 6 · Known limits

- **The Tauri shells get no Web Push.** Native notifications while running would
  need `tauri-plugin-notification`; quit-state delivery on iOS would need APNs,
  an Apple push certificate and a native plugin. Neither is built. The Mac app
  being usually-open makes this much less pressing than it sounds.
- **Never exercised against a live push service.** The keypair is set and
  *proven to sign* (§4's self-test passes, and the client/server keys match),
  but no notification has actually been delivered to a device — that needs a
  phone with the PWA installed and permission granted. Treat §4's checklist as
  the first real test.
- **One timezone per person.** `user_settings.time_zone` is kept fresh from
  whichever device last ran the app. Deadlines therefore speak at 9am in the
  zone you were most recently in, which is right for travel and slightly odd if
  two devices in different zones are both in daily use.
