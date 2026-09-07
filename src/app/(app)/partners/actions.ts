"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { requireRole, requireUser } from "@/lib/auth";
import { normalisePhone, toPesewas } from "@/lib/format";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function back(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

/**
 * The editable columns, read the same way whether adding or updating, so the
 * two forms can never drift apart in what they accept.
 *
 * `email` is citext and nullable — a blank field must become null rather than
 * an empty string, or a second blank partner collides on any future unique
 * index and reads as a real (empty) address in the meantime.
 */
function partnerFields(fd: FormData) {
  const phone = s(fd, "phone");
  const whatsapp = s(fd, "whatsapp");
  const commission = Number(fd.get("commission_pct"));
  return {
    name: s(fd, "name"),
    type: s(fd, "type") || "hotel",
    status: s(fd, "status") || "in_discussion",
    city: s(fd, "city") || "Accra",
    area: s(fd, "area"),
    address: s(fd, "address"),
    contact_name: s(fd, "contact_name"),
    contact_role: s(fd, "contact_role"),
    phone_e164: phone ? normalisePhone(phone) : "",
    whatsapp_e164: whatsapp ? normalisePhone(whatsapp) : phone ? normalisePhone(phone) : "",
    email: s(fd, "email") || null,
    commission_pct: Number.isFinite(commission) ? Math.min(Math.max(commission, 0), 100) : 0,
    partner_since: s(fd, "partner_since") || null,
    payment_terms: s(fd, "payment_terms"),
    payout_method: s(fd, "payout_method"),
    notes: s(fd, "notes"),
  };
}

/**
 * Add a partner. Staff — owner or booking officer — matching the
 * `partner_write` policy, which is what actually decides.
 */
export async function createPartner(formData: FormData) {
  const user = await requireRole("owner", "officer");
  const supabase = supabaseServer();
  const fields = partnerFields(formData);
  if (!fields.name) back("/partners/new", "A partner name is required.");

  const { data, error } = await supabase
    .from("partner").insert(fields).select("id").single();
  if (error || !data) back("/partners/new", error?.message ?? "Could not save the partner.");

  await supabase.from("partner_event").insert({
    partner_id: data.id, type: "note", actor_id: user.id,
    body: `Added as a ${fields.type.replace(/_/g, " ")} partner at ${fields.commission_pct}% commission.`,
  });

  revalidatePath("/partners");
  redirect(`/partners/${data.id}`);
}

/**
 * Update the agreement. A commission change is logged to the partner's
 * timeline: the ledger recalculates earnings at the current rate, so without
 * a note there would be no record of what the rate used to be.
 */
export async function updatePartner(formData: FormData) {
  const user = await requireRole("owner", "officer");
  const supabase = supabaseServer();
  const id = s(formData, "partner_id");
  const fields = partnerFields(formData);
  if (!fields.name) back(`/partners/${id}/edit`, "A partner name is required.");

  const { data: before } = await supabase
    .from("partner").select("commission_pct, status").eq("id", id).maybeSingle();

  const { error } = await supabase.from("partner").update(fields).eq("id", id);
  if (error) back(`/partners/${id}/edit`, error.message);

  const notes: string[] = [];
  if (before && Number(before.commission_pct) !== fields.commission_pct) {
    notes.push(`Commission changed from ${before.commission_pct}% to ${fields.commission_pct}%.`);
  }
  if (before && before.status !== fields.status) {
    notes.push(`Status changed from ${before.status.replace(/_/g, " ")} to ${fields.status.replace(/_/g, " ")}.`);
  }
  if (notes.length) {
    await supabase.from("partner_event").insert({
      partner_id: id, type: "note", actor_id: user.id, body: notes.join(" "),
    });
  }

  revalidatePath("/partners");
  revalidatePath(`/partners/${id}`);
  redirect(`/partners/${id}`);
}

/**
 * Archive rather than delete. Bookings reference the partner, and the ledger
 * is history — removing the row would silently rewrite what past months earned.
 */
export async function archivePartner(formData: FormData) {
  await requireRole("owner");
  const supabase = supabaseServer();
  const id = s(formData, "partner_id");
  const { error } = await supabase
    .from("partner").update({ archived_at: new Date().toISOString(), status: "ended" }).eq("id", id);
  if (error) back(`/partners/${id}`, error.message);
  revalidatePath("/partners");
  redirect("/partners");
}

/** Settle commission. Posts to expenses so it flows through the margin view. */
export async function recordPartnerPayout(formData: FormData) {
  await requireRole("owner");
  const user = await requireUser();
  const supabase = supabaseServer();
  const partnerId = s(formData, "partner_id");
  const amount = toPesewas(s(formData, "amount"));
  if (!amount) return;

  const { data: partner } = await supabase.from("partner").select("name").eq("id", partnerId).single();
  const { error } = await supabase.from("expense").insert({
    category: "partner_commission",
    vendor: partner?.name ?? "Partner",
    amount_pesewas: amount,
    method: s(formData, "method") || "bank_transfer",
    provider_ref: s(formData, "provider_ref"),
    partner_id: partnerId,
    notes: "Commission settlement.",
    actor_id: user.id,
  });
  if (error) redirect(`/partners/${partnerId}?error=${encodeURIComponent(error.message)}`);

  await supabase.from("partner_event").insert({
    partner_id: partnerId, type: "payout", actor_id: user.id,
    body: `Commission payout of GHS ${(amount / 100).toFixed(2)}.`,
  });
  revalidatePath(`/partners/${partnerId}`);
  revalidatePath("/finance");
}

export async function logPartnerEvent(formData: FormData) {
  const user = await requireUser();
  const supabase = supabaseServer();
  const partnerId = s(formData, "partner_id");
  const body = s(formData, "body");
  if (!body) return;
  await supabase.from("partner_event").insert({
    partner_id: partnerId, type: s(formData, "type") || "note", body, actor_id: user.id,
  });
  revalidatePath(`/partners/${partnerId}`);
}
