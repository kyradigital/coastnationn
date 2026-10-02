// Paystack verify — the backup to paystack-webhook.
//
// If Paystack's webhook is late, misconfigured or never arrives, the buyer would
// pay and get nothing. The ticket page calls this with the order reference; we ask
// Paystack's API directly whether that reference was paid, and if so issue the
// tickets through the same payment_webhook_confirm the webhook uses (idempotent,
// amount-checked). The browser's word is never trusted — only Paystack's API.
//
// Secrets: PAYSTACK_SECRET_KEY (same as the webhook), SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY (provided automatically).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const PAYSTACK_SECRET = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn} failed: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ ok: false, message: "method not allowed" }, 405);
  if (!PAYSTACK_SECRET) return reply({ ok: false, message: "not configured" }, 500);

  let reference = "";
  try {
    reference = String((await req.json())?.reference ?? "").trim().toUpperCase();
  } catch { /* fall through */ }
  // our references look like CN-261002-BFACC6 — refuse anything else before calling out
  if (!/^CN-\d{6}-[A-Z0-9]{6}$/.test(reference)) return reply({ ok: false, message: "bad reference" }, 400);

  let amountMajor: number | null = null;
  try {
    const res = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } },
    );
    const verify = await res.json();
    const status = verify?.data?.status ?? "unknown";
    if (!verify?.status || status !== "success") {
      // "abandoned", "ongoing", "pending", "failed" — nothing to issue yet
      return reply({ ok: false, paid: false, gateway_status: status });
    }
    amountMajor = typeof verify.data.amount === "number" ? verify.data.amount / 100 : null;
    const result = await rpc("payment_webhook_confirm", {
      p_secret: PAYSTACK_SECRET,
      p_reference: reference,
      p_provider: "paystack",
      p_provider_ref: String(verify.data.id ?? reference),
      p_amount: amountMajor,
    });
    console.log(`verify handled ${reference}:`, JSON.stringify(result));
    return reply({ ok: !!result?.ok, paid: true, result });
  } catch (e) {
    console.error("verify failed", reference, e);
    return reply({ ok: false, message: "verify failed" }, 502);
  }
});
