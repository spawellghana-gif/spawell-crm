"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/**
 * What the owner is allowed to delete, and where to go afterwards.
 *
 * An allow-list rather than "whatever table name the form posts": this action
 * is reachable by anyone who can reach the app, and a free-text table name
 * would let a crafted request aim it at `settings` or `app_user`.
 *
 * `audit_log` is deliberately absent. It has no delete policy at all, so the
 * database would refuse anyway — history stays even for the owner.
 */
const DELETABLE: Record<string, { label: string; back: string; revalidate: string[] }> = {
  enquiry:         { label: "enquiry",  back: "/enquiries", revalidate: ["/enquiries", "/"] },
  booking:         { label: "booking",  back: "/bookings",  revalidate: ["/bookings", "/finance", "/"] },
  client:          { label: "client",   back: "/clients",   revalidate: ["/clients"] },
  partner:         { label: "partner",  back: "/partners",  revalidate: ["/partners"] },
  therapist:       { label: "therapist", back: "/therapists", revalidate: ["/therapists"] },
  payment:         { label: "payment",  back: "",           revalidate: ["/finance", "/bookings", "/clients", "/partners", "/"] },
  expense:         { label: "expense",  back: "",           revalidate: ["/finance"] },
  task:            { label: "task",     back: "",           revalidate: ["/tasks"] },
  marketing_daily: { label: "marketing entry", back: "",    revalidate: ["/finance"] },
};

/** Preserve filters when returning to a payment list, always within this app. */
function resultUrl(path: string, key: "error" | "deleted", message: string) {
  const base = "https://crm.local";
  let url: URL;
  try {
    url = new URL(path, base);
  } catch {
    url = new URL("/", base);
  }
  if (url.origin !== base || url.pathname.startsWith("//")) url = new URL("/", base);
  url.searchParams.delete("error");
  url.searchParams.delete("deleted");
  url.searchParams.set(key, message);
  return `${url.pathname}${url.search}`;
}

/**
 * Turn a Postgres refusal into something an owner can act on.
 *
 * The schema uses `on delete restrict` in the places where a delete would
 * quietly corrupt the figures — a booking that has payments against it, a
 * client who has bookings. Postgres stops those; this explains why.
 */
function explain(code: string | undefined, message: string, label: string): string {
  if (code === "23503") {
    if (label === "booking") {
      return "This booking has payments recorded against it. Reverse the payments first — deleting it would change what the month collected.";
    }
    if (label === "client") {
      return "This client has bookings. Delete or reassign those first, or archive the client instead so the history stays intact.";
    }
    if (label === "therapist") {
      return "This therapist is assigned to bookings. Deactivate them instead — that takes them off the roster without erasing who did the work.";
    }
    return `Something else in the system still refers to this ${label}, so it cannot be deleted.`;
  }
  if (code === "42501" || /permission denied|policy/i.test(message)) {
    return `Only the owner can delete a ${label}.`;
  }
  return message;
}

/**
 * Permanently delete one record. Owner only, twice over: checked here for a
 * readable message, and enforced by the row-level security policy in the
 * database, which is what holds if this check is ever bypassed.
 *
 * Every delete lands in the audit log — the `audit_change` trigger writes the
 * full row as it was, before it goes.
 */
export async function deleteRecord(formData: FormData) {
  await requireRole("owner");

  const table = s(formData, "table");
  const id = s(formData, "id");
  const target = Object.hasOwn(DELETABLE, table) ? DELETABLE[table] : undefined;
  const from = s(formData, "from") || target?.back || "/";

  if (!target) redirect(`/?error=${encodeURIComponent("That kind of record cannot be deleted here.")}`);
  if (!id) redirect(resultUrl(from, "error", "Nothing was selected to delete."));

  // Typing the word is the whole safeguard on an irreversible action, so it is
  // checked on the server: a disabled button in the browser is not a control.
  if (s(formData, "confirm").toUpperCase() !== "DELETE") {
    redirect(resultUrl(from, "error", `Type DELETE to confirm removing this ${target.label}.`));
  }

  const supabase = supabaseServer();
  // Returning the removed row distinguishes a real deletion from an RLS-filtered
  // or already-deleted row, and gives us the related pages to refresh.
  const { data: removed, error } = await supabase.from(table).delete().eq("id", id)
    .select(table === "payment" ? "id, booking_id, client_id" : "id").maybeSingle();
  if (error) {
    redirect(resultUrl(from, "error", explain(error.code, error.message, target.label)));
  }
  if (!removed) {
    redirect(resultUrl(from, "error", `This ${target.label} was not found or could not be deleted. Refresh the page and try again.`));
  }

  if (table === "payment" && "booking_id" in removed && "client_id" in removed) {
    // The existing payment trigger recalculates payment status; reporting views
    // derive the collected amounts and balances from the remaining payments.
    revalidatePath(`/bookings/${removed.booking_id}`);
    revalidatePath(`/clients/${removed.client_id}`);
    revalidatePath("/partners/[id]", "page");
  }

  for (const path of target.revalidate) revalidatePath(path);
  redirect(resultUrl(target.back || from, "deleted", target.label));
}
