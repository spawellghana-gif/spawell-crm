"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { processQueue, backfillMissingConversions, refreshConversionStatuses } from "@/lib/conversions";
import { supabaseServer } from "@/lib/supabase/server";
import { googleAdsConfig, googleAdsMissing } from "@/lib/google-ads";
import { prepareGoogleAdsRuntime } from "@/lib/google-ads-runtime";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function back(message: string, kind: "error" | "ok" = "error"): never {
  redirect(`/marketing/google-ads?${kind}=${encodeURIComponent(message)}`);
}

/** Called only after the owner check. Keep the secret on the server, pin the
 * destination to this CRM, and never forward it through a redirect. This runs
 * the same authenticated endpoint and database identity as Vercel Cron. */
async function runScheduledConversionWorker(): Promise<Awaited<ReturnType<typeof processQueue>>> {
  let response: Response;
  try {
    response = await fetch("https://crm.spawellghana.com/api/conversions/sync", {
      method: "GET",
      headers: { authorization: `Bearer ${process.env.CRON_SECRET!.trim()}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new Error("The automatic worker could not be reached. Check the last worker run before retrying.");
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof result?.error === "string"
      ? `Automatic sync: ${result.error}`
      : `The automatic worker returned HTTP ${response.status}.`);
  }
  if (typeof result?.note !== "string" || ![result.attempted, result.synced, result.failed].every(Number.isFinite)) {
    throw new Error("The automatic worker returned an unexpected response. Check the last worker run before retrying.");
  }
  return { attempted: result.attempted, synced: result.synced, failed: result.failed,
    note: `Automatic worker: ${result.note}` };
}

export async function retryConversions(formData: FormData) {
  await requireRole("owner");
  const id = s(formData, "conversion_id");
  if (!id && process.env.VERCEL_ENV === "production" && process.env.CRON_SECRET?.trim()
    && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    let result;
    try { result = await runScheduledConversionWorker(); }
    catch (e) { back(e instanceof Error ? e.message : "Automatic sync failed."); }
    revalidatePath("/marketing/google-ads");
    back(result.note, result.failed && !result.synced ? "error" : "ok");
  }
  const supabase = supabaseServer();

  const prepared = await prepareGoogleAdsRuntime(supabase);
  if (!prepared.ok) back(prepared.reason);

  if (id) {
    const { error } = await supabase
      .from("conversion_event")
      .update({ status: "pending", next_attempt_at: new Date().toISOString(), attempts: 0, error_detail: "" })
      .eq("id", id)
      .in("status", ["failed", "pending"]);
    if (error) back(error.message);
  }

  let result;
  try {
    if (!id) await backfillMissingConversions(supabase);
    result = await processQueue(supabase, { limit: id ? 1 : 50, conversionId: id || undefined });
  } catch (e) { back(e instanceof Error ? e.message : "Conversion sync failed."); }
  revalidatePath("/marketing/google-ads");
  back(result.note, result.failed && !result.synced ? "error" : "ok");
}

export async function validateConversions() {
  await requireRole("owner");
  const supabase = supabaseServer();

  const prepared = await prepareGoogleAdsRuntime(supabase);
  if (!prepared.ok) back(prepared.reason);

  let result;
  try { result = await processQueue(supabase, { limit: 5, validateOnly: true }); }
  catch (e) { back(e instanceof Error ? e.message : "Conversion validation failed."); }
  revalidatePath("/marketing/google-ads");
  back(`Validation run: ${result.note}. Nothing was reported to Google.`, result.failed ? "error" : "ok");
}

export async function backfillConversions() {
  await requireRole("owner");
  const supabase = supabaseServer();

  let created;
  try { created = await backfillMissingConversions(supabase); }
  catch (e) { back(e instanceof Error ? e.message : "Backfill failed."); }
  revalidatePath("/marketing/google-ads");
  back(`${created} missing conversion records created. Existing receipts were retained.`, "ok");
}

export async function checkConversionProcessing() {
  await requireRole("owner");
  const supabase = supabaseServer();
  const prepared = await prepareGoogleAdsRuntime(supabase);
  if (!prepared.ok) back(prepared.reason);
  let result;
  try { result = await refreshConversionStatuses(supabase); }
  catch (e) { back(e instanceof Error ? e.message : "Google processing check failed."); }
  revalidatePath("/marketing/google-ads");
  back(result.note, result.failed ? "error" : "ok");
}

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

/**
 * Import a Google service-account JSON key into Supabase Vault.
 *
 * Retained only as a legacy fallback for non-Vercel environments. Production
 * uses Vercel OIDC + Google Workload Identity Federation and needs no key.
 */
export async function saveGoogleAdsServiceAccount(formData: FormData) {
  await requireRole("owner");
  const raw = s(formData, "service_account_json");
  if (!raw) back("Paste the downloaded Google service-account JSON file contents.");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    back("That is not valid JSON. Use the complete service-account key file downloaded from Google Cloud.");
  }

  if (parsed.type !== "service_account") {
    back("This must be a Google service-account JSON key (type: service_account).");
  }
  const projectId = typeof parsed.project_id === "string" ? parsed.project_id.trim() : "";
  const clientEmail = typeof parsed.client_email === "string" ? parsed.client_email.trim() : "";
  const privateKey = typeof parsed.private_key === "string" ? parsed.private_key : "";
  if (!projectId || !clientEmail || !privateKey) {
    back("The JSON is missing project_id, client_email or private_key.");
  }

  const supabase = supabaseServer();
  const { error } = await supabase.rpc("set_google_ads_service_account", {
    p_project_id: projectId,
    p_client_email: clientEmail,
    p_private_key: privateKey,
  });
  if (error) back(`Could not store the Google credential: ${error.message}`);

  const prepared = await prepareGoogleAdsRuntime(supabase);
  if (!prepared.ok) back(prepared.reason);

  revalidatePath("/marketing/google-ads");
  back(`Google service account ${clientEmail} is stored securely in Supabase Vault.`, "ok");
}
