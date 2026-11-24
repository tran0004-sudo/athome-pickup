// 앳홈 집앞 분리배출 | 알림 보내기 (웹 푸시)
//   · 새 신청(INSERT)        → 그 단지의 승인된 도우미들에게 "새 일감"
//   · 도우미 배정(accepted)  → 손님에게 "도우미가 맡았어요"
//   · 배출 완료(done)        → 손님에게 "배출 완료"
//
// 배포:  supabase functions deploy pickup-notify --no-verify-jwt
//   (Database Webhook 이 부르므로 JWT 확인은 끄고, 대신 비밀 헤더로 잠급니다)
// 필요한 Secrets (Supabase 대시보드 → Edge Functions → Secrets) — 카케어 notify-push 와 같은 값을 함께 씁니다:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, NOTIFY_WEBHOOK_SECRET
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 는 기본 제공
// Database Webhooks: pickup_requests 의 Insert·Update → 이 함수, HTTP Header "x-webhook-secret" = NOTIFY_WEBHOOK_SECRET 값
// 비밀 헤더가 없거나 다르면 401 로 거절합니다.
// 알림 내용에는 호수·연락처를 넣지 않습니다 (잠금 화면에 보일 수 있으므로).

import webpush from "https://esm.sh/web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
const WEBHOOK_SECRET = Deno.env.get("NOTIFY_WEBHOOK_SECRET") ?? "";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const SIZE: Record<string, string> = { S: "소", M: "중", L: "대" };
const ids = (list: string[]) => `(${list.map((v) => `"${v.replace(/"/g, "")}"`).join(",")})`;

async function sendTo(userIds: string[], message: Record<string, string>) {
  if (!userIds.length) return { sent: 0 };
  const res = await rest(`pickup_push_subscriptions?select=endpoint,p256dh,auth&user_id=in.${ids(userIds)}`);
  if (!res.ok) throw new Error(await res.text());
  const subs = await res.json();
  const body = JSON.stringify(message);
  let sent = 0;
  await Promise.allSettled(subs.map(async (s: { endpoint: string; p256dh: string; auth: string }) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 3600 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await rest(`pickup_push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE" });
      }
    }
  }));
  return { sent };
}

Deno.serve(async (req) => {
  if (!WEBHOOK_SECRET) {
    console.error("NOTIFY_WEBHOOK_SECRET 이 설정되지 않아 호출을 거절했습니다.");
    return json(401, { ok: false, error: "unauthorized" });
  }
  if (req.method !== "POST" || !safeEqual(req.headers.get("x-webhook-secret") ?? "", WEBHOOK_SECRET)) {
    return json(401, { ok: false, error: "unauthorized" });
  }

  try {
    const p = await req.json().catch(() => ({}));
    if (p?.table !== "pickup_requests" || !p?.record) return json(200, { ok: true, skipped: true });
    const row = p.record;
    const old = p.old_record ?? {};
    const when = `${String(row.pickup_date).slice(5).replace("-", "/")} ${String(row.slot_start).slice(0, 5)}`;

    // 1) 새 신청 → 같은 단지의 승인된 도우미 (신청한 본인은 제외)
    if (p.type === "INSERT" && row.status === "requested") {
      const hres = await rest(`pickup_helpers?select=user_id&status=eq.approved&complex_id=eq.${row.complex_id}`);
      if (!hres.ok) throw new Error(await hres.text());
      const helpers = (await hres.json()).map((h: { user_id: string }) => h.user_id).filter((id: string) => id !== row.user_id);
      const r = await sendTo(helpers, {
        title: "새 일감이 있어요",
        body: `${when} · ${row.dong}동 · ${SIZE[row.bag_size] ?? ""} ${row.bag_count}개 · 수고비 ${Number(row.helper_fee).toLocaleString("ko-KR")}원`,
        url: "./#/helper", tag: `job-${row.id}`,
      });
      return json(200, { ok: true, ...r });
    }

    // 2) 상태가 바뀌면 손님에게
    if (p.type === "UPDATE" && old.status !== row.status) {
      if (row.status === "accepted") {
        return json(200, { ok: true, ...(await sendTo([row.user_id], {
          title: "도우미가 맡았어요", body: `${when} 시간대에 문 앞 재활용품을 분리수거장에 내놓아 드릴게요.`, url: "./#/my", tag: `req-${row.id}`,
        })) });
      }
      if (row.status === "done") {
        return json(200, { ok: true, ...(await sendTo([row.user_id], {
          title: "분리배출을 마쳤어요", body: "완료 사진은 앱의 '내 신청'에서 볼 수 있어요.", url: "./#/my", tag: `req-${row.id}`,
        })) });
      }
    }
    return json(200, { ok: true, skipped: true });
  } catch (e) {
    console.error(e);
    return json(500, { ok: false, error: "failed" });
  }
});
