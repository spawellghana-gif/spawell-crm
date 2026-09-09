/**
 * Binding a captured ad click to an enquiry.
 *
 * Called when a booking officer saves an enquiry. If the customer's first
 * WhatsApp message carried a ref, the officer pastes it and the link is
 * deterministic. If not, this returns an unattributed record — it does not
 * guess, and it does not fall back to "the most recent click", because that
 * would attribute every walk-in to whoever last clicked an ad.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { extractToken, attributionStatus, crmSource } from "@/lib/attribution";

export type AttributionPatch = {
  ad_click_id: string | null;
  gclid: string;
  gbraid: string;
  wbraid: string;
  landing_page: string;
  first_touch_at: string | null;
  first_touch_source: string;
  last_touch_source: string;
  last_touch_at: string;
  ad_attribution_status: string;
  utm?: Record<string, string>;
  source?: string;
  campaign?: string;
};

/** Optional schema: a code deployment must not interrupt existing enquiries. */
export async function attributionSchemaReady(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase.from("enquiry").select("ad_click_id").limit(0);
  return !error;
}

const unattributed = (): AttributionPatch => ({
  ad_click_id: null,
  gclid: "", gbraid: "", wbraid: "",
  landing_page: "",
  first_touch_at: null,
  first_touch_source: "",
  last_touch_source: "whatsapp",
  last_touch_at: new Date().toISOString(),
  ad_attribution_status: "none",
});

/**
 * `rawRef` is whatever the officer pasted — a bare token, "ref: K7QP2M", or
 * the customer's whole first message. Anything unrecognised is treated as no
 * ref rather than as an error: a mistyped code should not block the enquiry.
 */
export async function claimAttribution(
  supabase: SupabaseClient,
  rawRef: string,
): Promise<AttributionPatch> {
  const token = extractToken(rawRef ?? "");
  if (!token) return unattributed();

  const { data: click } = await supabase
    .from("ad_click").select("*").eq("token", token).maybeSingle();
  if (!click) return unattributed();

  const status = attributionStatus(click);

  return {
    ad_click_id: click.id,
    gclid: click.gclid ?? "",
    gbraid: click.gbraid ?? "",
    wbraid: click.wbraid ?? "",
    landing_page: click.landing_page ?? "",
    // First touch is the click, not the moment an officer typed it up.
    first_touch_at: click.first_touch_at,
    first_touch_source: crmSource(click),
    last_touch_source: "whatsapp",
    last_touch_at: new Date().toISOString(),
    ad_attribution_status: status,
    utm: {
      source: click.utm_source ?? "",
      medium: click.utm_medium ?? "",
      campaign: click.utm_campaign ?? "",
      term: click.utm_term ?? "",
      content: click.utm_content ?? "",
    },
    // Let the click decide the lead source, so the Marketing page and the
    // attribution page cannot disagree about where a booking came from.
    source: crmSource(click),
    campaign: click.utm_campaign ?? "",
  };
}

/**
 * Mark the click as used. Separate from the read so the enquiry insert is not
 * held up by it, and so a failure to stamp the click never loses the enquiry.
 */
export async function markClickClaimed(
  supabase: SupabaseClient,
  clickId: string | null,
  enquiryId: string,
) {
  if (!clickId) return;
  try {
    await supabase.from("ad_click")
      .update({ claimed_by_enquiry_id: enquiryId, claimed_at: new Date().toISOString() })
      .eq("id", clickId)
      .is("claimed_by_enquiry_id", null);
  } catch {
    // The enquiry has already been saved; a failed stamp must not change that.
  }
}
