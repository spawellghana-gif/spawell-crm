"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { requireRole, requireUser } from "@/lib/auth";
import { toPesewas } from "@/lib/format";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

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
