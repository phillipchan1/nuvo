// Ensures the caller has a personal Stripe Promotion Code on the shared
// referral Coupon, and returns it. Authenticated — BillingPane calls this
// via supabase.functions.invoke("referral-code").
//
// New mints are always `NAME-XXXX` (unique by construction). Bare names like
// PHIL are launch seeds only — attached if already issued for this user.
//
// Env: STRIPE_SECRET_KEY, STRIPE_REFERRAL_COUPON (coup_… created once by
// scripts/create-referral-codes.mjs).
import { admin, handleOptions, json, requireUser } from "../_shared/admin.ts";
import {
  personalReferralCode,
  randomReferralSuffix,
  slugFromUser,
} from "../_shared/referralCode.ts";
import { stripe } from "../_shared/stripe.ts";

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
    let promo: { id: string; code: string } | null = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = personalReferralCode(base, randomReferralSuffix());
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
        // Extremely unlikely collision — draw another suffix.
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
