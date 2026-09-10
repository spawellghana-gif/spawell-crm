"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { processQueue, ensureConversionForBooking } from "@/lib/conversions";
import { supabaseServer } from "@/lib/supabase/server";
import { googleAdsConfig, googleAdsMissing } from "@/lib/google-ads";
import { prepareGoogleAdsRuntime } from "@/lib/google-ads-runtime";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function back(message: string, kind: "error" | "ok" = "error"): never {
  redirect(`/marketing/google-ads?${kind}=${encodeURIComponent(message)}`);
}

/**
 * Retry one conversion, or everything that is due.
 *
 * Owner actions intentionally use the signed-in Supabase session rather than
 * a service-role key. Row Level Security already grants the owner full access
 * to the conversion queue, so a missing server bypass key must not block a
 * legitimate interactive sync.
 */
export async function retryConversions(formData: FormData) {
  await requireRole("owner");
  const supabase = supabaseServer();

  const prepared = await prepareGoogleAdsRuntime(supabase);
  if (!prepared.ok) back(prepared.reason);

  const id = s(formData, "conversion_id");
  if (id) {
    const { error } = await supabase
      .from("conversion_event")
      .update({ status: "pending", next_attempt_at: new Date().toISOString(), attempts: 0, error_detail: "" })
      .eq("id", id)
      .in("status", ["failed", "pending"]);
    if (error) back(error.message);
  }

  const result = await processQueue(supabase, { limit: id ? 1 : 50, conversionId: id || undefined });
  revalidatePath("/marketing/google-ads");
  back(result.note, result.failed && !result.synced ? "error" : "ok");
}

/**
 * Send nothing, but ask Google whether it would accept what is queued.
 * The safe way to prove the integration before a real conversion is reported.
 */
export async function validateConversions() {
  await requireRole("owner");
  const supabase = supabaseServer();

  const prepared = await prepareGoogleAdsRuntime(supabase);
  if (!prepared.ok) back(prepared.reason);

  const result = await processQueue(supabase, { limit: 5, validateOnly: true });
  revalidatePath("/marketing/google-ads");
  back(`Validation run: ${result.note}. Nothing was reported to Google.`, result.failed ? "error" : "ok");
}

/**
 * Create any conversions that should exist but do not — bookings confirmed
 * before this module was installed, or while conversion sending was unavailable.
 * Idempotent by the same dedup key as everything else.
 */
export async function backfillConversions() {
  await requireRole("owner");
  const supabase = supabaseServer();

  const { data: confirmed, error } = await supabase
    .from("booking")
    .select("id")
    .in("status", ["confirmed", "therapist_assigned", "en_route", "arrived", "in_service", "completed", "paid"])
    .is("archived_at", null)
    .limit(500);
  if (error) back(error.message);

  let created = 0;
  for (const b of confirmed ?? []) {
    const r = await ensureConversionForBooking(supabase, b.id);
    if (r && (r.status === "pending" || r.status === "skipped")) created++;
  }

  revalidatePath("/marketing/google-ads");
  back(`Checked ${confirmed?.length ?? 0} confirmed bookings; ${created} conversion records created or updated.`, "ok");
}

/** The master switch, stored in settings so it survives a redeploy. */
export async function toggleSync(formData: FormData) {
  await requireRole("owner");
  const supabase = supabaseServer();
  const enabled = s(formData, "enabled") === "true";

  const prepared = await prepareGoogleAdsRuntime(supabase, { syncEnabled: enabled });
  if (!prepared.ok) back(prepared.reason);

  if (enabled && (googleAdsMissing().length || !googleAdsConfig().syncEnabled)) {
    back("Complete the Google Ads connection before enabling sync.");
  }
  const { error } = await supabase
    .from("settings").update({ google_ads_sync_enabled: enabled }).eq("id", true);
  if (error) back(error.message);
  revalidatePath("/marketing/google-ads");
  back(enabled
    ? "Sync switched on. Queued conversions can now be reported from the owner controls."
    : "Sync switched off. Conversions keep queuing; nothing is sent to Google.", "ok");
}
