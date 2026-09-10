"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { requireRole, requireUser } from "@/lib/auth";
import { normalisePhone, toPesewas } from "@/lib/format";
import { sendBookingToGa4, ga4SendConfigured } from "@/lib/ga4";
import { attributionSchemaReady, claimAttribution, markClickClaimed } from "@/lib/claim-attribution";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export type ReturningClientMatch = {
  id: string;
  fullName: string;
  phone: string;
  whatsapp: string;
  locationType: "home" | "hotel";
  area: string;
  address: string;
  landmark: string;
  completedBookings: number;
  lifetimeCollectedPesewas: number;
  lastVisitAt: string | null;
};

/** Look up a returning client while an officer is capturing an enquiry. */
export async function findReturningClient(rawPhone: string): Promise<ReturningClientMatch | null> {
  await requireRole("owner", "officer");
  const phone = normalisePhone(rawPhone);
  // Avoid querying partial numbers as the officer types.
  if (!/^\+\d{10,15}$/.test(phone)) return null;

  const { data, error } = await supabaseServer()
    .from("client_view")
    .select("id, full_name, phone_e164, whatsapp_e164, location_type, area, address, landmark, completed_bookings, lifetime_collected_pesewas, last_visit_at")
    .eq("phone_e164", phone)
    .is("archived_at", null)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id,
    fullName: data.full_name,
    phone: data.phone_e164,
    whatsapp: data.whatsapp_e164,
    locationType: data.location_type,
    area: data.area,
    address: data.address,
    landmark: data.landmark,
    completedBookings: Number(data.completed_bookings) || 0,
    lifetimeCollectedPesewas: Number(data.lifetime_collected_pesewas) || 0,
    lastVisitAt: data.last_visit_at,
  };
}

/** Capture a new enquiry. Links to an existing client when the phone matches. */
export async function createEnquiry(formData: FormData) {
  const user = await requireUser();
  const supabase = supabaseServer();
  const phone = normalisePhone(s(formData, "phone"));

  const { data: existing } = await supabase
    .from("client").select("id").eq("phone_e164", phone).is("archived_at", null).maybeSingle();

  // Advertising attribution, if the customer carried a ref through WhatsApp.
  // Nothing is guessed here: an absent or unknown ref leaves the enquiry
  // unattributed, which is the honest state.
  const hasAttribution = await attributionSchemaReady(supabase);
  const claimed = await claimAttribution(supabase, hasAttribution ? s(formData, "ad_ref") : "");
  // A captured click knows the true source; an officer picking from a dropdown
  // is guessing. Where the click says Google Ads, it wins — otherwise the
  // officer's choice stands.
  const { utm: claimedUtm, source: claimedSource, campaign: claimedCampaign, ...attribution } = claimed;

  const { data, error } = await supabase
    .from("enquiry")
    .insert({
      full_name: s(formData, "full_name"),
      phone_e164: phone,
      whatsapp_e164: formData.get("same_whatsapp") ? phone : normalisePhone(s(formData, "whatsapp")),
      channel: s(formData, "channel") || "whatsapp",
      source: claimedSource || s(formData, "source") || "direct_unknown",
      campaign: claimedCampaign || s(formData, "campaign"),
      partner_id: s(formData, "partner_id") || null,
      service_id: s(formData, "service_id") || null,
      duration_min: Number(formData.get("duration_min")) || null,
      preferred_at: s(formData, "preferred_at") ? new Date(s(formData, "preferred_at")).toISOString() : null,
      location_type: s(formData, "location_type") || "home",
      area: s(formData, "area"),
      address: s(formData, "address"),
      landmark: s(formData, "landmark"),
      guests: Number(formData.get("guests")) || 1,
      quote_pesewas: toPesewas(s(formData, "quote")),
      notes: s(formData, "notes"),
      client_id: existing?.id ?? null,
      ...(hasAttribution ? attribution : {}),
      owner_id: user.id,
      status: "new",
    })
    .select("id")
    .single();

  if (error) redirect(`/enquiries/new?error=${encodeURIComponent(error.message)}`);

  // Stamp the click as used, after the enquiry exists. Failing here costs the
  // claimed flag, never the enquiry.
  await markClickClaimed(supabase, attribution.ad_click_id, data!.id);

  // Refresh practical details only when the officer explicitly asks. The
  // original source and first campaign stay untouched as first-touch history.
  if (existing?.id && formData.get("update_client_profile")) {
    const { error: updateError } = await supabase.from("client").update({
      full_name: s(formData, "full_name"),
      whatsapp_e164: formData.get("same_whatsapp") ? phone : normalisePhone(s(formData, "whatsapp")),
      location_type: s(formData, "location_type") || "home",
      area: s(formData, "area"),
      address: s(formData, "address"),
      landmark: s(formData, "landmark"),
    }).eq("id", existing.id);
    if (updateError) {
      redirect(`/enquiries/${data!.id}?error=${encodeURIComponent("Enquiry saved, but the client profile could not be refreshed.")}`);
    }
  }

  revalidatePath("/enquiries");
  redirect(`/enquiries/${data!.id}`);
}

/** Log a call, message, note or quote against an enquiry. */
export async function logEvent(formData: FormData) {
  const user = await requireUser();
  const supabase = supabaseServer();
  const enquiryId = s(formData, "enquiry_id");
  const body = s(formData, "body");
  if (!body) return;

  await supabase.from("enquiry_event").insert({
    enquiry_id: enquiryId,
    type: s(formData, "type") || "note",
    body,
    actor_id: user.id,
  });

  const patch: Record<string, unknown> = {};
  const nextStatus = s(formData, "next_status");
  if (nextStatus) patch.status = nextStatus;
  const followUp = s(formData, "follow_up_at");
  if (followUp) patch.follow_up_at = new Date(followUp).toISOString();
  if (Object.keys(patch).length) {
    await supabase.from("enquiry").update(patch).eq("id", enquiryId);
  }
  revalidatePath(`/enquiries/${enquiryId}`);
}

export async function setEnquiryStatus(formData: FormData) {
  const supabase = supabaseServer();
  const id = s(formData, "enquiry_id");
  const status = s(formData, "status");
  const lostReason = s(formData, "lost_reason");

  const { error } = await supabase
    .from("enquiry")
    .update({
      status,
      // the database refuses 'lost' without a reason; clear it when reopening
      lost_reason: status === "lost" ? lostReason || "other" : null,
    })
    .eq("id", id);

  if (error) redirect(`/enquiries/${id}?error=${encodeURIComponent(error.message)}`);
  revalidatePath(`/enquiries/${id}`);
}

/**
 * Convert an enquiry into a booking in one action: create the client if this
 * is a new person, create the booking, point the enquiry at it, and keep the
 * source and campaign so attribution survives the conversion.
 */
export async function convertToBooking(formData: FormData) {
  const user = await requireUser();
  const supabase = supabaseServer();
  const enquiryId = s(formData, "enquiry_id");

  const { data: e, error: readErr } = await supabase
    .from("enquiry").select("*").eq("id", enquiryId).single();
  if (readErr || !e) redirect(`/enquiries/${enquiryId}?error=Enquiry not found`);

  // A booking must always name the service being delivered. Enquiries may be
  // captured before the client decides, so require the choice at conversion
  // time and return a useful operator message instead of a database error.
  const serviceId = s(formData, "service_id") || e.service_id;
  if (!serviceId) {
    redirect(`/enquiries/${enquiryId}?error=${encodeURIComponent("Choose a service before converting this enquiry to a booking.")}`);
  }
  const { data: selectedService } = await supabase
    .from("service").select("id, name").eq("id", serviceId).eq("active", true).maybeSingle();
  if (!selectedService) {
    redirect(`/enquiries/${enquiryId}?error=${encodeURIComponent("The selected service is unavailable. Choose an active service and try again.")}`);
  }

  // 1. client
  let clientId = e.client_id as string | null;
  if (!clientId) {
    const { data: found } = await supabase
      .from("client").select("id").eq("phone_e164", e.phone_e164).is("archived_at", null).maybeSingle();
    if (found) clientId = found.id;
    else {
      const { data: created, error: cErr } = await supabase
        .from("client")
        .insert({
          full_name: e.full_name, phone_e164: e.phone_e164,
          whatsapp_e164: e.whatsapp_e164 || e.phone_e164,
          location_type: e.location_type, area: e.area, address: e.address,
          landmark: e.landmark, source: e.source, first_campaign: e.campaign,
          pref_service_id: serviceId,
        })
        .select("id").single();
      if (cErr) redirect(`/enquiries/${enquiryId}?error=${encodeURIComponent(cErr.message)}`);
      clientId = created!.id;
    }
  }

  // 2. price and slot
  const startsAt = s(formData, "starts_at")
    ? new Date(s(formData, "starts_at"))
    : e.preferred_at ? new Date(e.preferred_at) : new Date(Date.now() + 864e5);
  const duration = Number(formData.get("duration_min")) || e.duration_min || 60;
  const guests = e.guests ?? 1;
  const endsAt = new Date(startsAt.getTime() + duration * 60000 * (guests > 1 ? 1 : 1));
  const transport = toPesewas(s(formData, "transport"));
  const base = toPesewas(s(formData, "base")) || e.quote_pesewas;

  const { data: booking, error: bErr } = await supabase
    .from("booking")
    .insert({
      client_id: clientId, enquiry_id: e.id, partner_id: e.partner_id,
      service_id: serviceId, duration_min: duration, guests,
      starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
      location_type: e.location_type, area: e.area, address: e.address,
      landmark: e.landmark, base_pesewas: base, transport_pesewas: transport,
      source: e.source, campaign: e.campaign,
      // Copied, not referenced: the conversion must still be correct if the
      // enquiry is later edited or archived.
      ...(Object.hasOwn(e, "ad_click_id") ? {
        ad_click_id: e.ad_click_id ?? null,
        gclid: e.gclid ?? "", gbraid: e.gbraid ?? "", wbraid: e.wbraid ?? "",
      } : {}),
      status: "awaiting_confirmation", created_by: user.id, updated_by: user.id,
      instructions_client: "Please have a quiet room, a towel and access to water ready.",
    })
    .select("id, ref").single();
  if (bErr) redirect(`/enquiries/${enquiryId}?error=${encodeURIComponent(bErr.message)}`);

  // 3. tell GA4 the enquiry turned into money.
  //
  // Deliberately not awaited into the redirect path in a way that can fail the
  // conversion: a booking must never be lost because Google was slow. The
  // timestamp records that it was reported, so a later retry cannot
  // double-count the revenue.
  if (ga4SendConfigured()) {
    const sent = await sendBookingToGa4({
      clientId: e.ga_client_id ?? "",
      sessionId: e.ga_session_id || undefined,
      bookingRef: booking!.ref,
      valuePesewas: base + transport,
      serviceName: selectedService.name,
    });
    if (sent.ok) {
      await supabase.from("booking")
        .update({ ga4_reported_at: new Date().toISOString() }).eq("id", booking!.id);
    }
  }

  // 4. close the loop on the enquiry
  await supabase.from("enquiry")
    .update({ status: "booked", booking_id: booking!.id, client_id: clientId, follow_up_at: null })
    .eq("id", e.id);
  await supabase.from("enquiry_event").insert({
    enquiry_id: e.id, type: "status", actor_id: user.id,
    body: `Converted to booking ${booking!.ref}. Source kept: ${e.source}${e.campaign ? ` · ${e.campaign}` : ""}.`,
  });

  revalidatePath("/enquiries");
  revalidatePath("/bookings");
  redirect(`/bookings/${booking!.id}`);
}
