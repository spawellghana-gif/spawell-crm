import type { SupabaseClient } from "@supabase/supabase-js";

export type GoogleAdsRuntimeSettings = {
  google_ads_customer_id: string | null;
  google_ads_conversion_action: string | null;
  google_ads_sync_enabled: boolean | null;
};

/**
 * Prepare the server-only Google Ads runtime from the sources we already own.
 *
 * Customer/conversion IDs are configuration, not secrets, so the CRM settings
 * table is their source of truth. The existing GA4 service account can also be
 * reused for Data Manager once that same identity is granted Google Ads access;
 * Ads-specific credentials still win when they are explicitly configured.
 *
 * process.env is populated only inside the server runtime so the existing Ads
 * uploader and its validation logic remain unchanged and no key reaches the
 * browser. Each call refreshes the values from the database, which prevents a
 * warm serverless instance from keeping a stale toggle or action id.
 */
export async function prepareGoogleAdsRuntime(
  supabase: SupabaseClient,
  opts: { syncEnabled?: boolean } = {},
): Promise<
  | { ok: true; settings: GoogleAdsRuntimeSettings }
  | { ok: false; reason: string }
> {
  const { data, error } = await supabase
    .from("settings")
    .select("google_ads_customer_id, google_ads_conversion_action, google_ads_sync_enabled")
    .eq("id", true)
    .maybeSingle();

  if (error) return { ok: false, reason: `Could not read Google Ads settings: ${error.message}` };
  if (!data) return { ok: false, reason: "Google Ads settings row is missing." };

  const settings = data as GoogleAdsRuntimeSettings;

  // Non-secret routing configuration is managed in the CRM database.
  process.env.GOOGLE_ADS_CUSTOMER_ID = (settings.google_ads_customer_id ?? "").trim();
  process.env.GOOGLE_ADS_CONVERSION_ACTION = (settings.google_ads_conversion_action ?? "").trim();

  // Reuse the already-working GA4 service account unless dedicated Ads
  // credentials have been supplied. The Google-side account permission is
  // still required; this merely avoids storing the same private key twice.
  if (!(process.env.GOOGLE_ADS_SA_CLIENT_EMAIL ?? "").trim()) {
    process.env.GOOGLE_ADS_SA_CLIENT_EMAIL = (process.env.GA4_SA_CLIENT_EMAIL ?? "").trim();
  }
  if (!(process.env.GOOGLE_ADS_SA_PRIVATE_KEY ?? "").trim()) {
    process.env.GOOGLE_ADS_SA_PRIVATE_KEY = (process.env.GA4_SA_PRIVATE_KEY ?? "").trim();
  }

  process.env.GOOGLE_ADS_SYNC_ENABLED = String(
    opts.syncEnabled ?? Boolean(settings.google_ads_sync_enabled),
  );

  return { ok: true, settings };
}
