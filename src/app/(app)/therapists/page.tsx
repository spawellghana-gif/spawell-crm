import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { prettyPhone, titleise } from "@/lib/format";
import { Card, Empty, PageHead, Chip, ErrorNote } from "@/components/ui";
import { setTherapistActive } from "./actions";
import type { Therapist } from "@/lib/types";

export const dynamic = "force-dynamic";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function TherapistsPage({
  searchParams,
}: { searchParams: { error?: string } }) {
  const user = await requireRole("owner", "officer");
  const supabase = supabaseServer();
  const isOwner = user.role === "owner";

  const [{ data: therapists }, { data: pay }] = await Promise.all([
    supabase.from("therapist").select("*").is("archived_at", null).order("full_name"),
    // Returns rows for the owner and nothing for anyone else — the policy,
    // not this page, is what decides.
    supabase.from("therapist_pay").select("therapist_id, commission_pct"),
  ]);
  const rows = (therapists ?? []) as Therapist[];
  const payBy = new Map((pay ?? []).map((p) => [p.therapist_id, p.commission_pct]));
  const showPay = isOwner && payBy.size > 0;
  const cols = 8 + (showPay ? 1 : 0) + (isOwner ? 1 : 0);

  return (
    <>
      <PageHead
        title="Therapists"
        blurb="Availability and skills. Pay lives in a separate table only the owner can read, so hiding a column is not what protects it."
        actions={isOwner ? <Link className="btn pri" href="/therapists/new">Add therapist</Link> : undefined}
      />
      <ErrorNote message={searchParams.error} />
      <Card pad={false}>
        <div className="tablewrap">
          <table>
            <thead><tr>
              <th>Therapist</th><th>Phone</th><th>Base</th><th>Days</th><th>Hours</th>
              <th className="r">Max/day</th><th className="r">Rating</th><th>Status</th>
              {showPay && <th className="r">Commission</th>}
              {isOwner && <th className="r"></th>}
            </tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td><b>{t.full_name}</b><div className="note">{titleise(t.gender)}</div></td>
                  <td className="mono">{prettyPhone(t.phone_e164)}</td>
                  <td>{t.base_area}</td>
                  <td className="note">{t.work_days.map((d) => DOW[d]).join(" ")}</td>
                  <td className="num">{t.work_start.slice(0, 5)}–{t.work_end.slice(0, 5)}</td>
                  <td className="r num">{t.max_daily}</td>
                  <td className="r num">{t.rating ?? "—"}</td>
                  <td>{t.active ? <Chip tone="ok">Active</Chip> : <Chip tone="bad">Inactive</Chip>}</td>
                  {showPay && <td className="r num">{payBy.get(t.id) ?? "—"}%</td>}
                  {isOwner && (
                    <td className="r">
                      <form action={setTherapistActive}>
                        <input type="hidden" name="therapist_id" value={t.id} />
                        <input type="hidden" name="active" value={t.active ? "false" : "true"} />
                        <button className="btn" type="submit">
                          {t.active ? "Deactivate" : "Reactivate"}
                        </button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={cols}>
                  <Empty title="No therapists yet">
                    {isOwner
                      ? "Add your first therapist to start assigning bookings."
                      : "The owner adds therapists to the roster."}
                  </Empty>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      {!isOwner && (
        <p className="note" style={{ marginTop: 8 }}>
          Pay is not shown for your role — and a request for it returns no rows, not a hidden column.
        </p>
      )}
    </>
  );
}
