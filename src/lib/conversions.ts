/**
 * Confirmed-booking conversions: creation, deduplication and submission.
 *
 * The ordering rule this file exists to enforce: a booking is confirmed in the
 * database first, and only then does anything think about Google. Advertising
 * is downstream of the business. If Google is unreachable, the booking is
 * still confirmed and the conversion waits.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase/config";
import {
  sendConversion, retrieveConversionStatus,
  googleAdsConfig, googleAdsConfigured, MAX_ATTEMPTS,
} from "@/lib/google-ads";

/** The idempotency key, and Google's transactionId. Derived from the booking
 *  reference because that is immutable — a retry, an edit or a restart cannot
 *  change it, which is exactly what a deduplication key must guarantee. */
export const dedupKey = (bookingRef: string) => `SPAWELL-${bookingRef}`;

/** Identify an accidentally copied public key without displaying any key
 * material. JWT claims are only a diagnostic here; Supabase verifies access. */
export function workerDatabaseConfigurationError(): string | null {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!key) return "Set SUPABASE_SERVICE_ROLE_KEY to the CRM project's Supabase Secret key.";
  let publicKey = key.startsWith("sb_publishable_");
  if (!publicKey && key.split(".").length === 3) {
    try {
      publicKey = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8")).role === "anon";
    } catch { /* The live Supabase request validates other credential formats. */ }
  }
  return publicKey
    ? "SUPABASE_SERVICE_ROLE_KEY contains a public key. Replace its value with the CRM project's Supabase Secret key and redeploy."
    : null;
}

/** Server-side client for the authenticated scheduled worker. */
export function serviceClient(): SupabaseClient | null {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!key) return null;
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type ConversionDecision =
  | { create: true; reason: string }
  | { create: false; skipReason: string };

/**
 * Should this booking produce a Google conversion at all?
 *
 * The spec is emphatic and so is this: a WhatsApp click is not a booking, and
 * a booking with no advertising evidence is not a Google conversion. Where
 * there is nothing to attribute, a row is still written — with status
 * 'skipped' and a reason — so the dashboard can show how many bookings had no
 * attribution rather than pretending they did not happen.
 */
export function decideConversion(booking: {
  gclid?: string; gbraid?: string; wbraid?: string;
  source?: string;
  client_email?: string; client_phone?: string;
}): ConversionDecision {
  if (booking.gclid) return { create: true, reason: "gclid" };
  if (booking.gbraid) return { create: true, reason: "gbraid" };
  if (booking.wbraid) return { create: true, reason: "wbraid" };

  // Enhanced conversions for leads can match on hashed first-party data alone,
  // but only when we independently know the lead came from Google Ads. Without
  // that, matching on a phone number would manufacture attribution for a
  // customer who found us on a flyer.
  const fromGoogleAds = booking.source === "google_search_ads";
  const matchable = Boolean(booking.client_phone || booking.client_email);
  if (fromGoogleAds && matchable) {
    return { create: true, reason: "google ads source with matchable customer data" };
  }
  if (fromGoogleAds && !matchable) {
    return { create: false, skipReason: "Google Ads lead but no phone or email to match on" };
  }
  return { create: false, skipReason: "no advertising attribution on this booking" };
}

/** Manual maintenance uses the same deterministic database function as the
 * booking trigger; database failures are surfaced instead of silently ignored. */
export async function ensureConversionForBooking(supabase: SupabaseClient, bookingId: string) {
  const { data, error } = await supabase.rpc("queue_booking_conversion", { p_booking_id: bookingId });
  if (error) throw new Error(`Could not queue booking: ${error.message}`);
  return data as { status: string; dedupKey: string; note: string } | null;
}

/** Repair gaps from older deployments. Only confirmed, non-archived bookings
 * without a queue row are visited. The database supplies the original data. */
export async function backfillMissingConversions(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("booking")
    .select("id, conversion_event!left(id)")
    .in("status", ["confirmed", "therapist_assigned", "en_route", "arrived", "in_service", "completed", "paid"])
    .not("confirmed_at", "is", null).is("archived_at", null)
    .is("conversion_event", null).order("confirmed_at").limit(100);
  if (error) throw new Error(`Could not check missing conversions: ${error.message}`);
  for (const booking of data ?? []) await ensureConversionForBooking(supabase, booking.id);
  return data?.length ?? 0;
}

/** Receipt checks do not upload or re-upload conversions, and are available
 * while sync is paused. A processing success is not proof of Ads attribution. */
export async function refreshConversionStatuses(supabase: SupabaseClient, limit = 20, deadline = Date.now() + 40_000) {
  const { data, error } = await supabase.from("conversion_event").select("id, google_response")
    .not("google_response->>requestId", "is", null)
    .in("google_processing_status", ["unchecked", "processing", "unknown"])
    .order("google_processing_checked_at", { ascending: true, nullsFirst: true }).limit(limit);
  if (error) throw new Error(`Could not read upload receipts: ${error.message}`);
  let checked = 0, failed = 0;
  for (const ev of data ?? []) {
    if (Date.now() > deadline) break;
    const result = await retrieveConversionStatus(ev.google_response.requestId);
    const { error: saveError } = await supabase.from("conversion_event").update({
      google_processing_status: result.status,
      google_processing_checked_at: new Date().toISOString(),
      google_processing_response: result.response,
      google_processing_error: result.error ?? "",
    }).eq("id", ev.id);
    if (saveError) throw new Error(`Could not save Google processing result: ${saveError.message}`);
    checked++;
    if (result.status === "failed" || result.status === "partial_success" || result.error) failed++;
  }
  return { checked, failed, note: `${checked} upload receipts checked; ${failed} need attention` };
}

/** A short processing budget leaves time to persist receipts before Vercel's
 * timeout. Claims older than ten minutes can be safely retried with the same
 * transaction ID. The final result and attempt history are one DB transaction. */
export async function processQueue(
  supabase: SupabaseClient,
  opts: { limit?: number; validateOnly?: boolean; conversionId?: string; deadline?: number } = {},
): Promise<{ attempted: number; synced: number; failed: number; note: string }> {
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? 25) || 25, 1), 200);
  const deadline = opts.deadline ?? Date.now() + 40_000;
  if (!googleAdsConfigured()) return { attempted: 0, synced: 0, failed: 0, note: "Configuration required — nothing was sent." };
  if (!opts.validateOnly) {
    if (!googleAdsConfig().syncEnabled) return { attempted: 0, synced: 0, failed: 0, note: "Sync is switched off — conversions are queuing." };
    const { data: settings, error } = await supabase.from("settings")
      .select("google_ads_sync_enabled").eq("id", true).maybeSingle();
    if (error || !settings?.google_ads_sync_enabled) return { attempted: 0, synced: 0, failed: 0, note: "Sync is paused in the CRM — nothing was sent." };
    const { error: recoveryError } = await supabase.from("conversion_event").update({
      status: "pending", next_attempt_at: new Date().toISOString(),
      error_detail: "Previous worker was interrupted; retrying the original transaction ID.",
    }).eq("status", "sending").lt("last_attempt_at", new Date(Date.now() - 10 * 60_000).toISOString());
    if (recoveryError) throw new Error(`Could not recover interrupted uploads: ${recoveryError.message}`);
  }
  let query = supabase.from("conversion_event").select("*").in("status", ["pending", "failed"])
    .lte("next_attempt_at", new Date().toISOString()).lt("attempts", MAX_ATTEMPTS)
    .order("next_attempt_at", { ascending: true }).limit(limit);
  if (opts.conversionId) query = query.eq("id", opts.conversionId);
  const { data: due, error: queueError } = await query;
  if (queueError) throw new Error(`Could not read the conversion queue: ${queueError.message}`);
  let synced = 0, failed = 0, attempted = 0, firstError = "";
  for (const ev of due ?? []) {
    if (Date.now() > deadline) break;
    let claimedAt = "";
    if (!opts.validateOnly) {
      const { data: claimed, error } = await supabase.from("conversion_event")
        .update({ status: "sending", last_attempt_at: new Date().toISOString() })
        .eq("id", ev.id).in("status", ["pending", "failed"])
        .select("id, last_attempt_at").maybeSingle();
      if (error) throw new Error(`Could not claim conversion: ${error.message}`);
      if (!claimed) continue;
      claimedAt = claimed.last_attempt_at;
    }
    attempted++;
    const result = await sendConversion({
      transactionId: ev.dedup_key, conversionAt: new Date(ev.conversion_at).toISOString(),
      valuePesewas: ev.value_pesewas, currency: ev.currency,
      gclid: ev.gclid || undefined, gbraid: ev.gbraid || undefined, wbraid: ev.wbraid || undefined,
      emailSha256: ev.email_sha256 || undefined, phoneSha256: ev.phone_sha256 || undefined,
    }, { validateOnly: opts.validateOnly });
    if (!opts.validateOnly) {
      const { data: saved, error } = await supabase.rpc("finish_conversion_attempt", {
        p_event_id: ev.id, p_claimed_at: claimedAt, p_ok: result.ok,
        p_http_status: result.httpStatus, p_response: result.response ?? null, p_error: result.error ?? "",
      });
      if (error || !saved) {
        failed++;
        firstError ||= "An upload result could not be saved. The original transaction ID will be retained for recovery.";
        continue;
      }
      if (result.ok) synced++;
    }
    if (!result.ok) {
      failed++;
      firstError ||= (result.error ?? `HTTP ${result.httpStatus}`).replace(/\s+/g, " ").slice(0, 400);
    }
  }
  return { attempted, synced, failed, note: (opts.validateOnly
    ? `${attempted - failed} validated, ${failed} failed validation`
    : attempted ? `${synced} uploaded, ${failed} failed` : "nothing due") + (firstError ? ` — ${firstError}` : "") };
}
