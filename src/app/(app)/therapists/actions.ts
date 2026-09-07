"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { normalisePhone, toPesewas } from "@/lib/format";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Working days arrive as repeated `work_days` checkbox values, 0 = Sunday. */
function workDays(fd: FormData): number[] {
  const days = fd.getAll("work_days")
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  // A therapist with no working days is never available for anything, which
  // is almost certainly a slip rather than an intention.
  return days.length ? Array.from(new Set(days)).sort() : [1, 2, 3, 4, 5, 6];
}

function back(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

/**
 * Add a therapist to the roster.
 *
 * Owner only — enforced here for a clean message, and again by the
 * `therapist_owner_write` policy in the database, which is what actually
 * stops an officer who calls the API directly.
 *
 * Pay is written to `therapist_pay`, a separate owner-only table. It is
 * separate precisely so that reading the roster never exposes it.
 */
export async function createTherapist(formData: FormData) {
  await requireRole("owner");
  const supabase = supabaseServer();

  const full_name = s(formData, "full_name");
  const phoneRaw = s(formData, "phone");
  if (!full_name) back("/therapists/new", "A name is required.");
  if (!phoneRaw) back("/therapists/new", "A phone number is required.");

  const start = s(formData, "work_start") || "09:00";
  const end = s(formData, "work_end") || "20:00";
  if (end <= start) back("/therapists/new", "The finish time must be after the start time.");

  const ratingRaw = s(formData, "rating");
  const rating = ratingRaw === "" ? null : Number(ratingRaw);
  if (rating !== null && (Number.isNaN(rating) || rating < 0 || rating > 5)) {
    back("/therapists/new", "Rating must be between 0 and 5, or left blank.");
  }

  const { data, error } = await supabase
    .from("therapist")
    .insert({
      full_name,
      phone_e164: normalisePhone(phoneRaw),
      gender: s(formData, "gender") || "female",
      city: s(formData, "city") || "Accra",
      base_area: s(formData, "base_area") || "Accra",
      active: formData.get("active") !== null,
      work_days: workDays(formData),
      work_start: start,
      work_end: end,
      max_daily: Number(formData.get("max_daily")) || 4,
      rating,
    })
    .select("id")
    .single();

  if (error || !data) back("/therapists/new", error?.message ?? "Could not save the therapist.");

  // Commission is optional; a zero row is still worth writing so the owner
  // sees an explicit 0% rather than an empty cell they have to interpret.
  const commission = Number(formData.get("commission_pct"));
  const { error: payError } = await supabase.from("therapist_pay").insert({
    therapist_id: data.id,
    commission_pct: Number.isFinite(commission) ? Math.min(Math.max(commission, 0), 100) : 0,
    hourly_pesewas: toPesewas(s(formData, "hourly")),
    notes: s(formData, "pay_notes"),
  });
  if (payError) {
    // The therapist exists; only the pay row failed. Say so rather than
    // implying nothing was saved.
    back("/therapists", `${full_name} was added, but their pay could not be saved: ${payError.message}`);
  }

  revalidatePath("/therapists");
  redirect("/therapists");
}

/** Take someone off the roster without deleting their booking history. */
export async function setTherapistActive(formData: FormData) {
  await requireRole("owner");
  const supabase = supabaseServer();
  const id = s(formData, "therapist_id");
  const active = s(formData, "active") === "true";

  const { error } = await supabase.from("therapist").update({ active }).eq("id", id);
  if (error) back("/therapists", error.message);
  revalidatePath("/therapists");
}
