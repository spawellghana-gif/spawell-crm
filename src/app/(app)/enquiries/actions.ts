"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { normalisePhone, toPesewas } from "@/lib/format";
import { sendBookingToGa4, ga4SendConfigured } from "@/lib/ga4";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Capture a new enquiry. Links to an existing client when the phone matches. */
export async function createEnquiry(formData: FormData) {
  const user = await requireUser();
  const supabase = supabaseServer();
  const phone = normalisePhone(s(formData, "phone"));

  const { data: existing } = await supabase
    .from("client").select("id").eq("phone_e164", phone).maybeSingle();

  const { data, error } = await supabase
    .from("enquiry")
    .insert({
      full_name: s(formData, "full_name"),
      phone_e164: phone,
      whatsapp_e164: formData.get("same_whatsapp") ? phone : normalisePhone(s(formData, "whatsapp")),
      channel: s(formData, "channel") || "whatsapp",
      source: s(formData, "source") || "direct_unknown",
      campaign: s(formData, "campaign"),
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
      owner_id: user.id,
      status: "new",
    })
    .select("id")
    .single();

  if (error) redirect(`/enquiries/new?error=${encodeURIComponent(error.message)}`);
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

  // 1. client
  let clientId = e.client_id as string | null;
  if (!clientId) {
    const { data: found } = await supabase
      .from("client").select("id").eq("phone_e164", e.phone_e164).maybeSingle();
    if (found) clientId = found.id;
    else {
      const { data: created, error: cErr } = await supabase
        .from("client")
        .insert({
          full_name: e.full_name, phone_e164: e.phone_e164,
          whatsapp_e164: e.whatsapp_e164 || e.phone_e164,
          location_type: e.location_type, area: e.area, address: e.address,
          landmark: e.landmark, source: e.source, first_campaign: e.campaign,
          pref_service_id: e.service_id,
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
      service_id: e.service_id, duration_min: duration, guests,
      starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
      location_type: e.location_type, area: e.area, address: e.address,
      landmark: e.landmark, base_pesewas: base, transport_pesewas: transport,
      source: e.source, campaign: e.campaign,
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
    const { data: svc } = await supabase
      .from("service").select("name").eq("id", e.service_id).maybeSingle();
    const sent = await sendBookingToGa4({
      clientId: e.ga_client_id ?? "",
      sessionId: e.ga_session_id || undefined,
      bookingRef: booking!.ref,
      valuePesewas: base + transport,
      serviceName: svc?.name ?? "Massage",
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
