/**
 * POST /api/conversions/sync
 *
 * The queue worker. Called on a schedule (Vercel Cron, or any external
 * scheduler) and by the owner's manual retry button.
 *
 * Protected by a shared secret rather than a user session, because a cron
 * caller has no session. Without CONVERSION_SYNC_SECRET set, the route refuses
 * everything — an unauthenticated endpoint that talks to your advertising
 * account is not a thing to leave open by accident.
 */

import { NextResponse } from "next/server";
import { serviceClient, processQueue, backfillMissingConversions, refreshConversionStatuses } from "@/lib/conversions";
import { prepareGoogleAdsRuntime } from "@/lib/google-ads-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorised(req: Request, key: "CONVERSION_SYNC_SECRET" | "CRON_SECRET"): boolean {
  const secret = (process.env[key] ?? "").trim();
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  return bearer === secret;
}

async function run(req: Request) {
  const startedAt = Date.now();
  const supabase = serviceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Server credentials are not configured." }, { status: 503 });
  }

  const prepared = await prepareGoogleAdsRuntime(supabase);
  if (!prepared.ok) {
    return NextResponse.json({ error: prepared.reason }, { status: 503 });
  }

  const url = new URL(req.url);
  const validateOnly = url.searchParams.get("validateOnly") === "1";
  try {
  if (!validateOnly) await backfillMissingConversions(supabase);
  const result = await processQueue(supabase, {
    limit: Math.min(Math.max(Math.floor(Number(url.searchParams.get("limit"))) || 25, 1), 200),
    // ?validateOnly=1 asks Google to check the payload without recording it —
    // the way to prove the wiring before a real conversion is ever reported.
    validateOnly,
    deadline: startedAt + 30_000,
  });
  const processing = !validateOnly && Date.now() < startedAt + 35_000
    ? await refreshConversionStatuses(supabase, 20, startedAt + 40_000) : null;
  if (!validateOnly) {
    const { error } = await supabase.from("settings").update({
      conversion_worker_last_run_at: new Date().toISOString(),
      conversion_worker_last_result: { ...result, processing },
    }).eq("id", true);
    if (error) throw new Error("Worker completed but could not save its run history.");
  }
  return NextResponse.json({ ...result, processing });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Conversion worker failed.";
    if (!validateOnly) await supabase.from("settings").update({
      conversion_worker_last_run_at: new Date().toISOString(),
      conversion_worker_last_result: { error },
    }).eq("id", true);
    return NextResponse.json({ error }, { status: 500 });
  }
}

/** External callers explicitly POST with the conversion worker secret. */
export async function POST(req: Request) {
  if (!authorised(req, "CONVERSION_SYNC_SECRET")) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }
  return run(req);
}

/** Vercel Cron invokes GET and authenticates with its CRON_SECRET variable. */
export async function GET(req: Request) {
  if (!authorised(req, "CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }
  return run(req);
}
