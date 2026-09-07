/**
 * GA4 and Google Ads via Windsor.ai.
 *
 * The alternative to a Google service account. Windsor already holds the
 * authorisation to both properties, so the CRM needs one API key rather than
 * a service account email, a private key and a property grant. Fewer moving
 * parts, and nothing to rotate when a key expires in Google Cloud.
 *
 * The trade is a third party in the path: if the Windsor account lapses, the
 * traffic figures stop. That is why `src/lib/ga4.ts` still exists — the direct
 * Google route is there when it is wanted, and the sync prefers it.
 *
 *   WINDSOR_API_KEY       from onboard.windsor.ai → Data preview
 *   WINDSOR_GA4_ACCOUNT   GA4 property id, e.g. 314693631
 *   WINDSOR_ADS_ACCOUNT   Google Ads customer id, e.g. 627-977-5396
 */

import type { Ga4Row } from "./ga4";

const env = (k: string) => (process.env[k] ?? "").trim();

export function windsorConfigured(): boolean {
  return Boolean(env("WINDSOR_API_KEY"));
}

export type AdsRow = {
  day: string;
  campaign: string;
  spend_source: number;
  currency: string;
  impressions: number;
  clicks: number;
};

async function windsorGet(connector: string, fields: string[], days: number): Promise<any[]> {
  const url = new URL(`https://connectors.windsor.ai/${connector}`);
  url.searchParams.set("api_key", env("WINDSOR_API_KEY"));
  url.searchParams.set("fields", fields.join(","));
  url.searchParams.set("date_preset", `last_${days}d`);

  const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.message ?? body?.error ?? `Windsor returned ${res.status}.`);
  }
  // Windsor answers either a bare array or {data: [...]} depending on connector.
  const rows = Array.isArray(body) ? body : body?.data;
  return Array.isArray(rows) ? rows : [];
}

/**
 * GA4's default channel grouping, rebuilt from source and medium.
 *
 * Windsor exposes source and medium but not `sessionDefaultChannelGroup`, and
 * the channel map table is keyed on GA4's names — so the grouping is derived
 * here to the same names GA4 itself would use. Kept in one place because the
 * scheduled sync applies the identical rules; two copies would drift and the
 * symptom would be a channel quietly splitting in two.
 */
export function channelGroup(source: string, medium: string, campaign: string): string {
  const s = (source ?? "").toLowerCase();
  const m = (medium ?? "").toLowerCase();
  if (campaign === "(cross-network)") return "Cross-network";
  if (m === "cpc" || m === "ppc" || m === "paid") return "Paid Search";
  if (m === "organic") return "Organic Search";
  if (m === "referral") {
    return /instagram|facebook|tiktok|l\.wl\.co|linkedin|pinterest/.test(s)
      ? "Organic Social"
      : "Referral";
  }
  if (m === "ai-assistant") return "Referral";
  if (s === "(direct)" || m === "(none)" || m === "") return "Direct";
  return "(other)";
}

export async function fetchGa4ViaWindsor(days = 30): Promise<Ga4Row[]> {
  const account = env("WINDSOR_GA4_ACCOUNT");
  const rows = await windsorGet(
    "googleanalytics4",
    ["date", "source", "medium", "campaign", "sessions", "totalusers", "conversions"],
    days,
  );

  return rows
    .filter((r) => !account || String(r.account_id ?? account) === account)
    .map((r) => ({
      day: String(r.date),
      channel_group: channelGroup(r.source, r.medium, r.campaign),
      source_medium: `${r.source ?? "(not set)"} / ${r.medium ?? "(not set)"}`,
      campaign: String(r.campaign ?? "(not set)"),
      sessions: Number(r.sessions) || 0,
      active_users: Number(r.totalusers) || 0,
      engaged_sessions: 0,
      key_events: Number(r.conversions) || 0,
    }));
}

export async function fetchAdsViaWindsor(days = 30): Promise<AdsRow[]> {
  const rows = await windsorGet(
    "google_ads",
    ["date", "campaign", "spend", "impressions", "clicks", "account_currency_code"],
    days,
  );

  return rows.map((r) => ({
    day: String(r.date),
    campaign: String(r.campaign ?? "(not set)"),
    spend_source: Number(r.spend) || 0,
    // Assume nothing: the account currency decides whether a conversion is
    // needed at all, and a wrong guess here silently misstates the money.
    currency: String(r.account_currency_code ?? "").toUpperCase() || "UNKNOWN",
    impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0,
  }));
}
