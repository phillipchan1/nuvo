// Ensures the caller has a personal Stripe Promotion Code on the shared
// referral Coupon, and returns it. Authenticated — BillingPane calls this
// via supabase.functions.invoke("referral-code").
//
// Env: STRIPE_SECRET_KEY, STRIPE_REFERRAL_COUPON (coup_… created once by
// scripts/create-referral-codes.mjs).
import { admin, handleOptions, json, requireUser } from "../_shared/admin.ts";
import { stripe } from "../_shared/stripe.ts";

function normalizeCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20);
}

function slugFromUser(user: { user_metadata?: Record<string, unknown>; email?: string | null }): string {
  const meta = user.user_metadata ?? {};
  const name =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    (user.email ? user.email.split("@")[0] : "") ||
    "FRIEND";
  const first = name.trim().split(/\s+/)[0] ?? "FRIEND";
  return normalizeCode(first) || "FRIEND";
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const couponId = Deno.env.get("STRIPE_REFERRAL_COUPON");
    if (!couponId) {
      return json({ error: "Referral codes are not configured yet" }, 503);
    }

    const { data: row, error: readErr } = await admin
      .from("subscriptions")
      .select("referral_code, stripe_promotion_code_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (readErr) throw readErr;

    if (row?.referral_code && row?.stripe_promotion_code_id) {
      return json({ code: row.referral_code });
    }

    // Prefer an already-issued Stripe code for this user (manual beta seed)
    // before creating a new one.
    if (!row?.referral_code) {
      const existing = await stripe.promotionCodes.list({
        limit: 100,
        coupon: couponId,
      });
      const mine = existing.data.find(
        (p) => p.metadata?.app === "nuvo" && p.metadata?.referrer_user_id === user.id,
      );
      if (mine?.code) {
        await admin
          .from("subscriptions")
          .update({
            referral_code: mine.code,
            stripe_promotion_code_id: mine.id,
          })
          .eq("user_id", user.id);
        return json({ code: mine.code });
      }
    }

    const base = slugFromUser(user);
    let code = base;
    let promo: { id: string; code: string } | null = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      code = normalizeCode(candidate) || `FRIEND-${attempt + 1}`;
      try {
        const created = await stripe.promotionCodes.create({
          coupon: couponId,
          code,
          metadata: {
            app: "nuvo",
            kind: "referral",
            referrer_user_id: user.id,
          },
        });
        promo = { id: created.id, code: created.code };
        break;
      } catch (e) {
        // Code already taken — try a suffix.
        const msg = e instanceof Error ? e.message : String(e);
        if (!/already|exists|taken|duplicate/i.test(msg)) throw e;
      }
    }
    if (!promo) {
      return json({ error: "Could not mint a unique code" }, 500);
    }

    const { error: writeErr } = await admin
      .from("subscriptions")
      .update({
        referral_code: promo.code,
        stripe_promotion_code_id: promo.id,
      })
      .eq("user_id", user.id);
    if (writeErr) throw writeErr;

    return json({ code: promo.code });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
