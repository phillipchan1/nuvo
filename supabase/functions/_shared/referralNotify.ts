/** Tell the referrer they earned a free month — push (if subscribed) + email (if Resend configured). */

import { admin, logSync } from "./admin.ts";
import { sendWebPush, webPushConfigured, type PushSubscriptionRow } from "./webpush.ts";

const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const MAIL_FROM = Deno.env.get("RESEND_FROM") ?? "Nuvo <hello@nuvo.day>";
const APP_URL = Deno.env.get("APP_URL") ?? "https://app.nuvo.day";

export async function notifyReferralCredit(referrerUserId: string): Promise<void> {
  const title = "You earned a free month";
  const body = "A friend subscribed with your code. $29 credit will apply to your next Nuvo invoice.";

  await Promise.all([
    pushCredit(referrerUserId, title, body),
    emailCredit(referrerUserId, title, body),
  ]);
}

async function pushCredit(userId: string, title: string, body: string): Promise<void> {
  if (!webPushConfigured()) return;
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, failure_count")
    .eq("user_id", userId);
  if (!subs?.length) return;

  const payload = JSON.stringify({
    title,
    body,
    key: `referral-credit-${Date.now()}`,
    url: "/",
  });

  for (const raw of subs) {
    const sub = raw as PushSubscriptionRow;
    const result = await sendWebPush(sub, payload);
    if (result.gone) {
      await admin.from("push_subscriptions").delete().eq("id", sub.id);
      continue;
    }
    await admin
      .from("push_subscriptions")
      .update(
        result.ok
          ? { last_seen_at: new Date().toISOString(), failure_count: 0 }
          : { failure_count: (sub.failure_count ?? 0) + 1 },
      )
      .eq("id", sub.id);
  }
}

async function emailCredit(userId: string, subject: string, body: string): Promise<void> {
  if (!RESEND_KEY) return;
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    const to = data?.user?.email;
    if (error || !to) return;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [to],
        subject,
        text: `${body}\n\nSee Settings → Billing: ${APP_URL}\n`,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      await logSync("stripe", "referral_credit_email", "error", `${res.status} ${detail}`, userId);
    } else {
      await logSync("stripe", "referral_credit_email", "ok", undefined, userId);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("stripe", "referral_credit_email", "error", msg, userId);
  }
}
