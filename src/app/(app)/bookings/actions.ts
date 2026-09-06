"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { toPesewas } from "@/lib/format";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function note(bookingId: string, body: string) {
  const user = await requireUser();
  const supabase = supabaseServer();
  await supabase.from("booking_event").insert({ booking_id: bookingId, body, actor_id: user.id });
}

/**
 * Move a booking along. The database has the final say: the therapist guard
 * refuses statuses a therapist may not set, so we surface its message rather
 * than deciding here.
 */
export async function setBookingStatus(formData: FormData) {
  const supabase = supabaseServer();
  const id = s(formData, "booking_id");
  const status = s(formData, "status");
  const patch: Record<string, unknown> = { status };
  if (status === "cancelled_client" || status === "cancelled_business") {
    patch.cancel_reason = s(formData, "cancel_reason") || "other";
    patch.cancel_fee_pesewas = toPesewas(s(formData, "cancel_fee"));
  }
  const { error } = await supabase.from("booking").update(patch).eq("id", id);
  if (error) redirect(`/bookings/${id}?error=${encodeURIComponent(error.message)}`);
  await note(id, `Status set to ${status.replace(/_/g, " ")}.`);
  revalidatePath(`/bookings/${id}`);
  revalidatePath("/bookings");
}

/** Assign or unassign a therapist, after checking availability in the database. */
export async function assignTherapist(formData: FormData) {
  const supabase = supabaseServer();
  const bookingId = s(formData, "booking_id");
  const therapistId = s(formData, "therapist_id");
  const assign = s(formData, "assign") === "1";

  if (!assign) {
    await supabase.from("booking_therapist").delete()
      .eq("booking_id", bookingId).eq("therapist_id", therapistId);
    await note(bookingId, "Therapist unassigned.");
    revalidatePath(`/bookings/${bookingId}`);
    return;
  }

  const { data: booking } = await supabase
    .from("booking").select("starts_at, ends_at, buffer_before_min, buffer_after_min")
    .eq("id", bookingId).single();
  if (!booking) redirect(`/bookings/${bookingId}?error=Booking not found`);

  // Ask the database, not the browser — the same check a phone app would get.
  const { data: availability } = await supabase.rpc("therapist_availability", {
    p_therapist: therapistId,
    p_starts: booking.starts_at,
    p_ends: booking.ends_at,
    p_buffer_before: booking.buffer_before_min,
    p_buffer_after: booking.buffer_after_min,
    p_ignore_booking: bookingId,
  });
  const verdict = availability?.[0];
  const force = s(formData, "force") === "1";
  if (verdict && !verdict.available && !force) {
    redirect(`/bookings/${bookingId}?warn=${encodeURIComponent(verdict.reason)}&pending=${therapistId}`);
  }

  const { error } = await supabase.from("booking_therapist")
    .insert({ booking_id: bookingId, therapist_id: therapistId });
  if (error && !error.message.includes("duplicate")) {
    redirect(`/bookings/${bookingId}?error=${encodeURIComponent(error.message)}`);
  }
  await supabase.from("booking").update({ status: "therapist_assigned" })
    .eq("id", bookingId).eq("status", "confirmed");
  await note(bookingId, verdict && !verdict.available
    ? `Therapist assigned despite a warning: ${verdict.reason}.`
    : "Therapist assigned.");
  revalidatePath(`/bookings/${bookingId}`);
}

/** Record a deposit, a balance or a refund. Payment status updates itself. */
export async function recordPayment(formData: FormData) {
  const user = await requireUser();
  const supabase = supabaseServer();
  const bookingId = s(formData, "booking_id");
  const kind = s(formData, "kind");
  const magnitude = toPesewas(s(formData, "amount"));
  if (!magnitude) return;

  const { data: booking } = await supabase
    .from("booking").select("client_id").eq("id", bookingId).single();
  if (!booking) redirect(`/bookings/${bookingId}?error=Booking not found`);

  const { error } = await supabase.from("payment").insert({
    booking_id: bookingId,
    client_id: booking.client_id,
    // refunds are stored negative so sum(amount) is always net collected
    amount_pesewas: kind === "refund" ? -Math.abs(magnitude) : Math.abs(magnitude),
    kind,
    method: s(formData, "method") || "mobile_money",
    provider_ref: s(formData, "provider_ref"),
    actor_id: user.id,
  });
  if (error) redirect(`/bookings/${bookingId}?error=${encodeURIComponent(error.message)}`);
  revalidatePath(`/bookings/${bookingId}`);
  revalidatePath("/finance");
}

export async function rescheduleBooking(formData: FormData) {
  const supabase = supabaseServer();
  const id = s(formData, "booking_id");
  const startsAt = s(formData, "starts_at");
  const duration = Number(formData.get("duration_min")) || 60;
  if (!startsAt) return;
  const start = new Date(startsAt);
  const end = new Date(start.getTime() + duration * 60000);

  const { error } = await supabase.from("booking")
    .update({ starts_at: start.toISOString(), ends_at: end.toISOString(), status: "rescheduled" })
    .eq("id", id);
  if (error) redirect(`/bookings/${id}?error=${encodeURIComponent(error.message)}`);
  await note(id, `Rescheduled to ${start.toISOString()}${s(formData, "reason") ? ` — ${s(formData, "reason")}` : ""}.`);
  revalidatePath(`/bookings/${id}`);
}
