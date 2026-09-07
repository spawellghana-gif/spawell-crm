"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { toPesewas } from "@/lib/format";
import { fetchGa4Daily, ga4ReadConfigured, type Ga4Row } from "@/lib/ga4";
import { fetchGa4ViaWindsor, fetchAdsViaWindsor, windsorConfigured } from "@/lib/windsor";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function back(message: string, kind: "error" | "ok" = "error"): never {
  redirect(`/marketing?${kind}=${encodeURIComponent(message)}`);
}

/**
 * Replace a window of days rather than merging into it.
 *
 * GA4 and Google Ads both restate recent days as late events and final costs
 * land. An upsert on the natural key would leave yesterday's superseded rows
 * in place beside today's corrected ones and double-count. Deleting the days
 * first makes a re-sync idempotent, which is what lets this run on a schedule
 * and by hand without anyone tracking which already ran.
 */
async function replaceDays(
  table: string,
  days: string[],
  rows: Record<string, unknown>[],
  filter?: { column: string; value: string },
) {
  const supabase = supabaseServer();
  let del = supabase.from(table).delete().in("day", days);
  if (filter) del = del.eq(filter.column, filter.value);
  const { error: delError } = await del;
  if (delError) throw new Error(delError.message);

  if (rows.length) {
    const { error } = await supabase.from(table).insert(rows);
    if (error) throw new Error(error.message);
  }
}

/**
 * Pull traffic and ad spend.
 *
 * Prefers the direct Google service account when it is configured, and falls
 * back to Windsor. Both produce the same shape, so the rest of the app cannot
 * tell which was used — the connection panel says so explicitly instead.
 */
export async function syncGa4(formData: FormData) {
  await requireRole("owner");
  const days = Math.min(Math.max(Number(formData.get("days")) || 30, 1), 365);
  const supabase = supabaseServer();

  if (!ga4ReadConfigured() && !windsorConfigured()) {
    back("No analytics connection is configured. Add either WINDSOR_API_KEY, or the three GA4 service-account variables, in Vercel.");
  }

  let traffic: Ga4Row[] = [];
  let via = "";

  try {
    if (ga4ReadConfigured()) {
      const result = await fetchGa4Daily(days);
      if (!result.ok) throw new Error(result.reason);
      traffic = result.rows;
      via = "Google directly";
    } else {
      traffic = await fetchGa4ViaWindsor(days);
      via = "Windsor";
    }
  } catch (e) {
    back(`Could not read GA4: ${e instanceof Error ? e.message : "request failed"}`);
  }

  const notes: string[] = [];

  try {
    const trafficDays = [...new Set(traffic.map((r) => r.day))];
    if (trafficDays.length) {
      await replaceDays("ga4_daily", trafficDays, traffic);
      notes.push(`${traffic.length} traffic rows across ${trafficDays.length} days`);
    }
  } catch (e) {
    back(`GA4 read fine but the write failed: ${e instanceof Error ? e.message : "unknown error"}`);
  }

  // Ad spend rides along on the same sync — the whole point of the page is
  // spend against outcomes, and a traffic-only refresh leaves it half true.
  if (windsorConfigured()) {
    try {
      const ads = await fetchAdsViaWindsor(days);
      if (ads.length) {
        const { data: settings } = await supabase
          .from("settings").select("ads_usd_ghs_rate").eq("id", true).maybeSingle();
        const rate = Number(settings?.ads_usd_ghs_rate) || 0;
        const currency = ads[0].currency;

        // Converting with a rate of zero would silently zero the spend, and a
        // wrong currency would misstate it. Neither is worth guessing past.
        if (currency !== "GHS" && !rate) {
          notes.push(`ad spend skipped — set the ${currency}→GHS rate first`);
        } else {
          const factor = currency === "GHS" ? 1 : rate;
          const adDays = [...new Set(ads.map((a) => a.day))];
          await replaceDays(
            "marketing_daily",
            adDays,
            ads.map((a) => ({
              day: a.day,
              platform: "google_search_ads",
              campaign: a.campaign,
              spend_pesewas: Math.round(a.spend_source * factor * 100),
              impressions: a.impressions,
              clicks: a.clicks,
              source_currency: currency,
              fx_rate: currency === "GHS" ? null : rate,
            })),
            { column: "platform", value: "google_search_ads" },
          );
          await supabase.from("settings").update({ ads_last_sync_at: new Date().toISOString() }).eq("id", true);
          notes.push(`${adDays.length} days of ad spend${currency === "GHS" ? "" : ` converted from ${currency} at ${rate}`}`);
        }
      }
    } catch (e) {
      // A spend failure must not lose the traffic that already landed.
      notes.push(`ad spend failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  await supabase.from("settings").update({ ga4_last_sync_at: new Date().toISOString() }).eq("id", true);
  revalidatePath("/marketing");
  back(`Synced via ${via}: ${notes.join("; ") || "nothing returned for that period"}.`, "ok");
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

/**
 * The USD→GHS rate used when importing Google Ads spend.
 *
 * Only affects imports made from now on. Rows already stored keep the rate
 * they were converted at, recorded on the row, so correcting the rate today
 * never silently restates what a past month cost.
 */
export async function setFxRate(formData: FormData) {
  await requireRole("owner");
  const rate = Number(formData.get("ads_usd_ghs_rate"));
  if (!Number.isFinite(rate) || rate <= 0) back("Enter the rate as a number, e.g. 11.39.");

  const supabase = supabaseServer();
  const { error } = await supabase.from("settings").update({ ads_usd_ghs_rate: rate }).eq("id", true);
  if (error) back(error.message);

  revalidatePath("/marketing");
  back(`Rate set to ${rate}. Spend imported from now on uses it; past rows keep the rate they were converted at.`, "ok");
}
