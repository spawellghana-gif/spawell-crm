/**
 * POST /api/attribution
 *
 * Called by spawellghana.com when a visitor arrives. Stores the ad click
 * first-party and returns a short token for the WhatsApp handoff.
 *
 * Public and unauthenticated by necessity — the caller is an anonymous
 * browser. It is therefore write-only and reveals nothing: the response is the
 * token the caller just caused to exist, and there is no endpoint anywhere
 * that turns a token back into click data without a signed-in staff session.
 *
 * Uses the public Supabase anon key to call a narrowly-scoped SECURITY DEFINER
 * function. That function can only insert capped attribution fields into
 * ad_click, so this route no longer depends on a Vercel service-role secret.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { mintToken, sanitiseClick, attributionStatus } from "@/lib/attribution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_ORIGINS = (process.env.ATTRIBUTION_ALLOWED_ORIGINS ?? "https://spawellghana.com,https://www.spawellghana.com")
  .split(",").map((o) => o.trim()).filter(Boolean);

function cors(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? "";
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function POST(req: Request) {
  const headers = cors(req.headers.get("origin"));
  const origin = req.headers.get("origin");
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    return NextResponse.json({ error: "Origin is not allowed." }, { status: 403, headers });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400, headers });
  }

  const click = sanitiseClick((body ?? {}) as Record<string, string>);

  // Nothing worth storing. Returning 204 rather than an error keeps the
  // website's snippet simple — it can post unconditionally on every page load.
  if (attributionStatus(click) === "none") {
    return new NextResponse(null, { status: 204, headers });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Retry on the vanishingly unlikely token collision rather than returning an
  // error the website has no way to act on.
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = mintToken();
    const { error } = await supabase.rpc("capture_ad_click", {
      p_token: token,
      p_gclid: click.gclid,
      p_gbraid: click.gbraid,
      p_wbraid: click.wbraid,
      p_utm_source: click.utm_source,
      p_utm_medium: click.utm_medium,
      p_utm_campaign: click.utm_campaign,
      p_utm_term: click.utm_term,
      p_utm_content: click.utm_content,
      p_landing_page: click.landing_page,
      p_referrer: click.referrer,
    });

    if (!error) {
      return NextResponse.json({ token }, { status: 201, headers });
    }
    if (error.code !== "23505") {
      return NextResponse.json({ error: "Could not store attribution." }, { status: 500, headers });
    }
  }

  return NextResponse.json({ error: "Could not allocate a token." }, { status: 500, headers });
}
