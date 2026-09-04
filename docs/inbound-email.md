# Inbox address — forward a mail, get a task

**Status:** built 2026-09-04 (D-134). Schema has been live since migration 43;
the webhook existed only on the deployed project and rewrote titles with a
model. This is the version in the repo: subject is the title, body is notes,
the row lands in the inbox.

**Ledger:** D6 (capture) · A1 (one inbox) · a slice of A3 (promises made in
mail). **Strains** P3 (we do not rewrite the capture) and P9 (no notification
that mail arrived). **Does not** add a pool, a second inbox, or a form.

---

## 1 · What it is

Every account already has `user_settings.inbound_token` — twelve hex chars.
The address is:

```
<token>@inbox.nuvo.day
```

Forward or BCC a message there. Resend receives at the domain, POSTs
`email.received` to `inbound-email`, and Nuvo inserts one `tasks` row:

| Email | Task |
|---|---|
| Subject (Re:/Fwd: stripped) | `title` |
| From + body (+ attachment names) | `notes` |
| — | `status = inbox`, `source = email` |

Nothing is dated, parented, or prioritized. Passive grooming (`enrichInbox`)
guesses a home on first open, the same as a typed capture. The inbox is the
only new surface — there is no mail history screen. `inbound_emails` is an
idempotency ledger keyed by Resend's `email_id`, so a Svix retry cannot
create a twin.

---

## 2 · Why the subject is the title

A deployed preview asked a model to turn the thread into an "imperative
action" and explicitly *not* echo the subject. That is P3: Nuvo deciding what
you meant. It was also slow, billed, and wrong when the subject *was* the
work ("Invoice 4412").

The subject is what you forwarded. Re:/Fwd: prefixes are not. An empty
subject becomes `Email from {name}`. A time of day in the subject stays in
the title — this is not capture-grammar, and parsing it would schedule from
mail, which skips the week gate (P2).

---

## 3 · The path

```
Gmail / Mail  ──forward──▶  <token>@inbox.nuvo.day
                               │
                               ▼
                         Resend receiving
                               │  email.received (metadata only)
                               ▼
              POST /functions/v1/inbound-email
                  Svix HMAC  →  token → user
                  GET /emails/receiving/:id  →  body
                  INSERT tasks (inbox)
                               │
                               ▼
                         Inbox (Realtime)
```

Auth is the signature plus the unguessable local-part. `verify_jwt` is off:
Resend cannot send a Supabase JWT. Unknown tokens return 200 so Resend does
not retry mail we cannot route. 30 mails per account per minute, then 429.

The address is shown in **Settings → Inbox address**, and on an empty inbox.
Copy it. "Get a new address" (Settings only) calls `rotate_inbound_token()`;
the old local-part dies. Direct client writes to `inbound_token` are reverted
by trigger. It is not under Apps & devices — that pane is HTTP tokens.

---

## 4 · Resend wiring (once)

Outbound referral mail already uses `RESEND_API_KEY` / `RESEND_FROM`. Inbound
needs three more things, all on the **Nuvo** Resend account (not another
product's key in `.env.local`):

1. **Receiving domain** `inbox.nuvo.day`. Do not put receiving MX on
   `nuvo.day` — that apex already forwards `hello@` through the registrar.
2. **MX** exactly as Resend's domain page specifies.
3. **Webhook** `email.received` →
   `https://ebibzojtkzkphykznomv.supabase.co/functions/v1/inbound-email`
   Copy the signing secret.

```bash
supabase secrets set \
  RESEND_WEBHOOK_SECRET=whsec_… \
  INBOUND_MAIL_DOMAIN=inbox.nuvo.day \
  --project-ref ebibzojtkzkphykznomv
```

`RESEND_API_KEY` must already be set (the webhook fetches the body; Resend
does not put it on the event). The SPA prints `VITE_INBOUND_MAIL_DOMAIN` if
set, otherwise `inbox.nuvo.day`.

Until MX answers, Resend's managed `*.resend.app` subdomain can receive; set
both domain env vars to that host so Settings copies an address that works.

---

## 5 · What it deliberately does not do

- **No LLM rewrite.** Grooming already exists.
- **No push** that mail arrived (N-07 / P9). The inbox is the tell.
- **No attachments stored.** Filenames go in notes; the file stays in mail.
- **No second ＋** and no mail-only composer (P5, D-125).
- **No marketing claim** until this has been driven with a real forward
  (D-094 still holds for the site).

Pure rules live in `_shared/inboundEmail.ts` and are asserted by
`tests/inbound-email.test.ts`.
