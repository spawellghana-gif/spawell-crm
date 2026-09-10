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
  sendConversion, hashEmail, hashPhone, nextAttemptAt,
  googleAdsConfig, googleAdsConfigured, MAX_ATTEMPTS,
} from "@/lib/google-ads";

/** The idempotency key, and Google's transactionId. Derived from the booking
 *  reference because that is immutable — a retry, an edit or a restart cannot
 *  change it, which is exactly what a deduplication key must guarantee. */
export const dedupKey = (bookingRef: string) => `SPAWELL-${bookingRef}`;

/** Server-side client that bypasses RLS. Only ever used by the queue worker
 *  and the confirmation hook, never in a request that a browser can shape. */
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

/**
 * Create or revive the conversion for a booking that has just been confirmed.
 *
 * Idempotent by construction. Called twice, called after a page refresh,
 * called again when the officer saves the same status a second time — one row
 * exists and one conversion is ever reported.
 *
 * Reconfirmation reuses the same row and transaction id. A previously accepted
 * upload is retained; this integration does not retract conversions in Google.
 */
export async function ensureConversionForBooking(
  supabase: SupabaseClient,
  bookingId: string,
): Promise<{ status: string; dedupKey: string; note: string } | null> {
  const { data: b } = await supabase
    .from("booking")
    .select("id, ref, status, client_id, total_pesewas, source, gclid, gbraid, wbraid, confirmed_at")
    .eq("id", bookingId)
    .maybeSingle();
  if (!b) return null;
  if (!["confirmed", "therapist_assigned", "en_route", "arrived", "in_service", "completed", "paid"].includes(b.status)) return null;
  if (!b.confirmed_at) return null;

  const key = dedupKey(b.ref);

  const { data: client } = await supabase
    .from("client").select("phone_e164").eq("id", b.client_id).maybeSingle();

  const decision = decideConversion({
    gclid: b.gclid, gbraid: b.gbraid, wbraid: b.wbraid,
    source: b.source,
    client_phone: client?.phone_e164,
  });

  const { data: existing } = await supabase
    .from("conversion_event").select("id, status, revision, google_response").eq("dedup_key", key).maybeSingle();

  if (existing) {
    if (existing.status === "synced") {
      return { status: "synced", dedupKey: key, note: "already reported to Google" };
    }
    if (existing.status === "void") {
      const previouslyUploaded = Boolean(existing.google_response?.requestId);
      await supabase.from("conversion_event").update({
        status: previouslyUploaded ? "synced" : decision.create ? "pending" : "skipped",
        skip_reason: decision.create ? "" : decision.skipReason,
        revision: (existing.revision ?? 1) + 1,
        attempts: 0,
        next_attempt_at: previouslyUploaded || !decision.create ? null : new Date().toISOString(),
        error_detail: "",
      }).eq("id", existing.id);
      return { status: previouslyUploaded ? "synced" : "requeued", dedupKey: key, note: "reconfirmed — original conversion record retained" };
    }
    return { status: existing.status, dedupKey: key, note: "already queued" };
  }

  await supabase.from("conversion_event").insert({
    dedup_key: key,
    booking_id: b.id,
    client_id: b.client_id,
    event_name: "confirmed_booking",
    gclid: b.gclid ?? "",
    gbraid: b.gbraid ?? "",
    wbraid: b.wbraid ?? "",
    phone_sha256: client?.phone_e164 ? hashPhone(client.phone_e164) : "",
    conversion_at: b.confirmed_at,
    value_pesewas: b.total_pesewas ?? 0,
    currency: "GHS",
    status: decision.create ? "pending" : "skipped",
    skip_reason: decision.create ? "" : decision.skipReason,
    next_attempt_at: decision.create ? new Date().toISOString() : null,
  });

  return {
    status: decision.create ? "pending" : "skipped",
    dedupKey: key,
    note: decision.create ? decision.reason : decision.skipReason,
  };
}

export async function voidConversionForBooking(supabase: SupabaseClient, bookingRef: string) {
  await supabase.from("conversion_event")
    .update({ status: "void", next_attempt_at: null })
    .eq("dedup_key", dedupKey(bookingRef))
    .in("status", ["pending", "failed", "synced"]);
}

/**
 * Submit everything that is due. Safe to run concurrently and safe to run
 * again immediately — a row is claimed by moving it to 'sending' first.
 */
export async function processQueue(
  supabase: SupabaseClient,
  opts: { limit?: number; validateOnly?: boolean; conversionId?: string } = {},
): Promise<{ attempted: number; synced: number; failed: number; note: string }> {
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? 25) || 25, 1), 200);

  if (!googleAdsConfigured()) {
    return { attempted: 0, synced: 0, failed: 0, note: "Configuration required — nothing was sent." };
  }
  if (!opts.validateOnly) {
    if (!googleAdsConfig().syncEnabled) {
      return { attempted: 0, synced: 0, failed: 0, note: "Sync is switched off — conversions are queuing." };
    }
    const { data: settings, error } = await supabase.from("settings")
      .select("google_ads_sync_enabled").eq("id", true).maybeSingle();
    if (error || !settings?.google_ads_sync_enabled) {
      return { attempted: 0, synced: 0, failed: 0, note: "Sync is paused in the CRM — nothing was sent." };
    }
  }

  let query = supabase
    .from("conversion_event")
    .select("*")
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .lt("attempts", MAX_ATTEMPTS)
    .order("next_attempt_at", { ascending: true })
    .limit(limit);
  if (opts.conversionId) query = query.eq("id", opts.conversionId);
  const { data: due, error: queueError } = await query;
  if (queueError) {
    return { attempted: 0, synced: 0, failed: 1, note: `Could not read the conversion queue: ${queueError.message}` };
  }

  let synced = 0, failed = 0, attempted = 0;
  let firstValidationError = "";

  for (const ev of due ?? []) {
    if (!opts.validateOnly) {
      const { data: claimed } = await supabase
        .from("conversion_event")
        .update({ status: "sending", last_attempt_at: new Date().toISOString() })
        .eq("id", ev.id)
        .in("status", ["pending", "failed"])
        .select("id")
        .maybeSingle();
      if (!claimed) continue;
    }

    attempted++;
    const attemptNo = (ev.attempts ?? 0) + 1;

    const result = await sendConversion({
      transactionId: ev.dedup_key,
      conversionAt: new Date(ev.conversion_at).toISOString(),
      valuePesewas: ev.value_pesewas,
      currency: ev.currency,
      gclid: ev.gclid || undefined,
      gbraid: ev.gbraid || undefined,
      wbraid: ev.wbraid || undefined,
      emailSha256: ev.email_sha256 || undefined,
      phoneSha256: ev.phone_sha256 || undefined,
    }, { validateOnly: opts.validateOnly });

    if (opts.validateOnly) {
      if (!result.ok) {
        failed++;
        if (!firstValidationError) {
          firstValidationError = (result.error ?? `HTTP ${result.httpStatus}`).replace(/\s+/g, " ").slice(0, 400);
        }
      }
      continue;
    }

    await supabase.from("conversion_attempt").insert({
      conversion_id: ev.id,
      attempt_no: attemptNo,
      ok: result.ok,
      http_status: result.httpStatus,
      response: result.response ?? null,
      error_detail: result.error ?? "",
    });

    if (result.ok) {
      synced++;
      await supabase.from("conversion_event").update({
        status: "synced",
        attempts: attemptNo,
        next_attempt_at: null,
        google_response: result.response ?? null,
        error_detail: "",
      }).eq("id", ev.id);
    } else {
      failed++;
      const next = nextAttemptAt(attemptNo);
      await supabase.from("conversion_event").update({
        status: next ? "pending" : "failed",
        attempts: attemptNo,
        next_attempt_at: next ? next.toISOString() : null,
        error_detail: (result.error ?? "").slice(0, 1000),
      }).eq("id", ev.id);
    }
  }

  return {
    attempted, synced, failed,
    note: opts.validateOnly
      ? `${attempted - failed} validated, ${failed} failed validation${firstValidationError ? ` — first error: ${firstValidationError}` : ""}`
      : attempted ? `${synced} uploaded, ${failed} failed` : "nothing due",
  };
}
