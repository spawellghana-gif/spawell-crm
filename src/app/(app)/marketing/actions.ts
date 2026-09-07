"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { toPesewas } from "@/lib/format";
import { fetchGa4Daily } from "@/lib/ga4";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function back(message: string, kind: "error" | "ok" = "error"): never {
  redirect(`/marketing?${kind}=${encodeURIComponent(message)}`);
}

/**
 * Replace a window of days rather than merging into it.
 *
 * GA4 restates recent days as late events arrive.
 * An upsert on the natural key would leave yesterday's superseded rows
 * in place beside today's corrected ones and double-count. Deleting the days
 * first makes a re-sync idempotent.
 */
async function replaceDays(
  table: string,
  days: string[],
  rows: Record<string, unknown>[],
) {
  const supabase = supabaseServer();
  const { error: delError } = await supabase.from(table).delete().in("day", days);
  if (delError) throw new Error(delError.message);

  if (rows.length) {
    const { error } = await supabase.from(table).insert(rows);
    if (error) throw new Error(error.message);
  }
}

/** Import website traffic directly from the Google Analytics Data API. */
export async function syncGa4(formData: FormData) {
  await requireRole("owner");
  const days = Math.min(Math.max(Math.floor(Number(formData.get("days"))) || 30, 1), 365);
  const result = await fetchGa4Daily(days);
  if (!result.ok) back(result.reason);
  const traffic = result.rows;
  const trafficDays = [...new Set(traffic.map((r) => r.day))];

  try {
    if (trafficDays.length) {
      await replaceDays("ga4_daily", trafficDays, traffic);
    }
  } catch (e) {
    back(`GA4 read fine but the write failed: ${e instanceof Error ? e.message : "unknown error"}`);
  }

  const supabase = supabaseServer();
  const { error } = await supabase.from("settings").update({
    ga4_property_id: (process.env.GA4_PROPERTY_ID ?? "").trim(),
    ga4_last_sync_at: new Date().toISOString(),
  }).eq("id", true);
  revalidatePath("/marketing");
  if (error) back(`Google answered, but saving the sync status failed: ${error.message}`);
  back(traffic.length
    ? `Synced directly from Google Analytics: ${traffic.length} traffic rows across ${trafficDays.length} days.`
    : "Google Analytics answered successfully, but returned no traffic for this period.", "ok");
}

/** Record what a channel cost on a day. Upserts on (day, platform, campaign). */
export async function recordSpend(formData: FormData) {
  await requireRole("owner", "officer");
  const supabase = supabaseServer();

  const day = s(formData, "day");
  const platform = s(formData, "platform");
  if (!day || !platform) back("Pick a date and a channel.");

  const { error } = await supabase.from("marketing_daily").upsert({
    day,
    platform,
    campaign: s(formData, "campaign"),
    spend_pesewas: toPesewas(s(formData, "spend")),
    impressions: Number(formData.get("impressions")) || 0,
    clicks: Number(formData.get("clicks")) || 0,
    source_currency: "GHS",
    fx_rate: null,
  }, { onConflict: "day,platform,campaign" });

  if (error) back(error.message);
  revalidatePath("/marketing");
  back("Spend recorded.", "ok");
}

/** Retune how a GA4 channel name maps onto a CRM lead source. */
export async function setChannelMap(formData: FormData) {
  await requireRole("owner");
  const supabase = supabaseServer();
  const { error } = await supabase.from("ga4_channel_map").upsert({
    ga4_channel: s(formData, "ga4_channel"),
    crm_source: s(formData, "crm_source"),
  }, { onConflict: "ga4_channel" });
  if (error) back(error.message);
  revalidatePath("/marketing");
  back("Channel mapping updated.", "ok");
}
