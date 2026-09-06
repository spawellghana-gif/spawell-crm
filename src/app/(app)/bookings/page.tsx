import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fmtDate, fmtTime, ghsShort, todayAccra } from "@/lib/format";
import { Card, Empty, PageHead, BookingChip, Chip } from "@/components/ui";
import { STATUS_LABEL, type BookingView, type BookingStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BookingsPage({
  searchParams,
}: { searchParams: { status?: string; when?: string; q?: string } }) {
  const user = await requireUser();
  const supabase = supabaseServer();
  const today = todayAccra();

  let query = supabase.from("booking_view").select("*").is("archived_at", null);
  if (searchParams.status) query = query.eq("status", searchParams.status);
  if (searchParams.when === "upcoming") query = query.gte("starts_at", `${today}T00:00:00`);
  if (searchParams.when === "past") query = query.lt("starts_at", `${today}T00:00:00`);
  if (searchParams.q) query = query.or(`ref.ilike.%${searchParams.q}%,client_name.ilike.%${searchParams.q}%,area.ilike.%${searchParams.q}%`);

  const { data } = await query.order("starts_at", { ascending: false }).limit(200);
  const rows = (data ?? []) as BookingView[];

  return (
    <>
      <PageHead
        title="Bookings"
        blurb={
          user.role === "therapist"
            ? "Only the appointments assigned to you are listed — that is enforced by the database, not the screen."
            : "Every appointment from draft through to payment."
        }
      />

      <form className="row" style={{ marginBottom: 12 }}>
        <input className="inp" name="q" defaultValue={searchParams.q ?? ""}
          placeholder="Ref, client or area" style={{ maxWidth: 240 }} />
        <select className="inp" name="status" defaultValue={searchParams.status ?? ""} style={{ maxWidth: 200 }}>
          <option value="">All statuses</option>
          {(Object.keys(STATUS_LABEL) as BookingStatus[]).map((k) => (
            <option key={k} value={k}>{STATUS_LABEL[k]}</option>
          ))}
        </select>
        <select className="inp" name="when" defaultValue={searchParams.when ?? ""} style={{ maxWidth: 150 }}>
          <option value="">Any date</option>
          <option value="upcoming">Upcoming</option>
          <option value="past">Past</option>
        </select>
        <button className="btn" type="submit">Filter</button>
        <Link className="btn" href="/bookings">Clear</Link>
      </form>

      <Card pad={false}>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Ref</th><th>Appointment</th><th>Client</th><th>Service</th>
                <th>Where</th><th>Therapist</th><th>Status</th>
                <th className="r">Total</th><th className="r">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td className="mono"><Link href={`/bookings/${b.id}`}>{b.ref}</Link></td>
                  <td>{fmtDate(b.starts_at)}<div className="note num">{fmtTime(b.starts_at)}–{fmtTime(b.ends_at)}</div></td>
                  <td><b>{b.client_name}</b></td>
                  <td>{b.service_name}<div className="note">{b.duration_min}m · {b.guests} guest{b.guests > 1 ? "s" : ""}</div></td>
                  <td>{b.location_type === "hotel" ? "Hotel" : "Home"}<div className="note">{b.area}</div></td>
                  <td>{b.therapist_names?.join(", ") ?? <Chip tone="warn">Unassigned</Chip>}</td>
                  <td><BookingChip status={b.status} /></td>
                  <td className="r num">{ghsShort(b.total_pesewas)}</td>
                  <td className="r num">
                    {b.balance_pesewas > 0
                      ? <span style={{ color: "var(--bad)", fontWeight: 600 }}>{ghsShort(b.balance_pesewas)}</span>
                      : <Chip tone="ok">Settled</Chip>}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={9}><Empty title="No bookings match">Convert an enquiry to create one.</Empty></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="note" style={{ marginTop: 8 }}>{rows.length} shown.</p>
    </>
  );
}
