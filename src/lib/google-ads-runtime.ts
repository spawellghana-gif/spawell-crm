import type { SupabaseClient } from "@supabase/supabase-js";

export type GoogleAdsRuntimeSettings = {
  google_ads_customer_id: string | null;
  google_ads_conversion_action: string | null;
  google_ads_sync_enabled: boolean | null;
};

type VaultServiceAccount = {
  project_id?: unknown;
  client_email?: unknown;
  private_key?: unknown;
};

/**
 * Prepare the server-only Google Ads runtime from sources owned by the CRM.
 *
 * Customer/conversion IDs are non-secret configuration stored in settings.
 * The preferred credential source is the owner-controlled Supabase Vault
 * secret. Dedicated Vercel env vars remain a fallback, followed by the
 * existing GA4 service account when one is available.
 *
 * The Vault RPC is SECURITY DEFINER and refuses non-owner callers (except a
 * future service-role cron worker). Secrets are copied only into this server
 * process and are never returned to a browser component.
 */
export async function prepareGoogleAdsRuntime(
  supabase: SupabaseClient,
  opts: { syncEnabled?: boolean; loadCredentials?: boolean } = {},
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

  process.env.GOOGLE_ADS_CUSTOMER_ID = (settings.google_ads_customer_id ?? "").trim();
  process.env.GOOGLE_ADS_CONVERSION_ACTION = (settings.google_ads_conversion_action ?? "").trim();

  let vaultLoaded = false;
  if (opts.loadCredentials !== false) {
    const { data: secret, error: secretError } = await supabase.rpc("get_google_ads_service_account");
    if (!secretError && secret && typeof secret === "object") {
      const credential = secret as VaultServiceAccount;
      const projectId = typeof credential.project_id === "string" ? credential.project_id.trim() : "";
      const email = typeof credential.client_email === "string" ? credential.client_email.trim() : "";
      const key = typeof credential.private_key === "string" ? credential.private_key.trim() : "";
      if (projectId && email && key) {
        process.env.GOOGLE_ADS_QUOTA_PROJECT_ID = projectId;
        process.env.GOOGLE_ADS_SA_CLIENT_EMAIL = email;
        process.env.GOOGLE_ADS_SA_PRIVATE_KEY = key;
        vaultLoaded = true;
      }
    }
  }

  if (!vaultLoaded) {
    if (!(process.env.GOOGLE_ADS_QUOTA_PROJECT_ID ?? "").trim()) {
      process.env.GOOGLE_ADS_QUOTA_PROJECT_ID = (process.env.GOOGLE_CLOUD_PROJECT ?? "").trim();
    }
    if (!(process.env.GOOGLE_ADS_SA_CLIENT_EMAIL ?? "").trim()) {
      process.env.GOOGLE_ADS_SA_CLIENT_EMAIL = (process.env.GA4_SA_CLIENT_EMAIL ?? "").trim();
    }
    if (!(process.env.GOOGLE_ADS_SA_PRIVATE_KEY ?? "").trim()) {
      process.env.GOOGLE_ADS_SA_PRIVATE_KEY = (process.env.GA4_SA_PRIVATE_KEY ?? "").trim();
    }
  }

  process.env.GOOGLE_ADS_SYNC_ENABLED = String(
    opts.syncEnabled ?? Boolean(settings.google_ads_sync_enabled),
  );

  return { ok: true, settings };
}
