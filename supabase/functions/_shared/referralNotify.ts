/** Notify the referrer — code used, or free-month credit landed. */

import { admin, logSync } from "./admin.ts";
import { sendWebPush, webPushConfigured, type PushSubscriptionRow } from "./webpush.ts";

const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const MAIL_FROM = Deno.env.get("RESEND_FROM") ?? "Nuvo <hello@nuvo.day>";
const APP_URL = Deno.env.get("APP_URL") ?? "https://app.nuvo.day";

export async function notifyReferralCodeUsed(referrerUserId: string): Promise<void> {
  await notify(referrerUserId, {
    title: "A friend used your Nuvo code",
    body: "Nice. You’ll get a free month when they pay — up to 6.",
    kind: "referral_use",
  });
}

export async function notifyReferralCredit(referrerUserId: string): Promise<void> {
  await notify(referrerUserId, {
    title: "You earned a free month of Nuvo",
    body: "A friend paid with your code. $29 credit lands on your next invoice.",
    kind: "referral_credit",
  });
}

async function notify(
  userId: string,
  msg: { title: string; body: string; kind: string },
): Promise<void> {
  await Promise.all([
    pushNotify(userId, msg.title, msg.body, msg.kind),
    emailNotify(userId, msg.title, msg.body, msg.kind),
  ]);
}

async function pushNotify(
  userId: string,
  title: string,
  body: string,
  kind: string,
): Promise<void> {
  if (!webPushConfigured()) return;
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, failure_count")
    .eq("user_id", userId);
  if (!subs?.length) return;

  const payload = JSON.stringify({
    title,
    body,
    key: `${kind}-${Date.now()}`,
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

async function emailNotify(
  userId: string,
  subject: string,
  body: string,
  kind: string,
): Promise<void> {
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
        text: `${body}\n\nSettings → Billing: ${APP_URL}\n`,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      await logSync("stripe", `${kind}_email`, "error", `${res.status} ${detail}`, userId);
    } else {
      await logSync("stripe", `${kind}_email`, "ok", undefined, userId);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("stripe", `${kind}_email`, "error", msg, userId);
  }
}
