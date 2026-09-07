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
 * Pull traffic from GA4 into ga4_daily.
 *
 * Rows are replaced day by day rather than merged: GA4 restates recent days as
 * late events arrive, so an upsert on the natural key would leave yesterday's
 * superseded rows behind and double-count sessions. Deleting the window first
 * makes a re-sync idempotent.
 */
export async function syncGa4(formData: FormData) {
  await requireRole("owner");
  const days = Math.min(Math.max(Number(formData.get("days")) || 30, 1), 365);

  const result = await fetchGa4Daily(days);
  if (!result.ok) back(result.reason);
  if (!result.rows.length) back("GA4 answered, but returned no traffic for that period.", "ok");

  const supabase = supabaseServer();
  const days_in = Array.from(new Set(result.rows.map((r) => r.day)));

  const { error: clearError } = await supabase.from("ga4_daily").delete().in("day", days_in);
  if (clearError) back(clearError.message);

  const { error } = await supabase.from("ga4_daily").insert(result.rows);
  if (error) back(error.message);

  await supabase.from("settings").update({ ga4_last_sync_at: new Date().toISOString() }).eq("id", true);

  revalidatePath("/marketing");
  back(`Synced ${result.rows.length} rows across ${days_in.length} days from GA4.`, "ok");
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
