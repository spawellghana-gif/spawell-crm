import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { ghsShort, ghs, fmtDate, fmtTime, todayAccra, addDays } from "@/lib/format";
import { Card, Kpi, Empty, PageHead, BookingChip, EnquiryChip, Chip } from "@/components/ui";
import type { BookingView, EnquiryView } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Dashboard({
  searchParams,
}: { searchParams: { from?: string; to?: string } }) {
  const user = await requireUser();
  const supabase = supabaseServer();
  const today = todayAccra();
  const from = searchParams.from ?? addDays(today, -29);
  const to = searchParams.to ?? today;

  // A therapist gets their own day, not the business.
  if (user.role === "therapist") {
    const { data: mine } = await supabase
      .from("booking_view")
      .select("*")
      .gte("starts_at", `${today}T00:00:00`)
      .order("starts_at");
    const list = (mine ?? []) as BookingView[];
    const todays = list.filter((b) => b.starts_at.slice(0, 10) === today);
    return (
      <>
        <PageHead title="My day" blurb={`${user.fullName} · ${fmtDate(today)}. You see only the appointments assigned to you.`} />
        <div className="kpis" style={{ marginBottom: 14 }}>
          <Kpi label="Today" value={todays.length} />
          <Kpi label="Upcoming" value={list.length} />
        </div>
        <Card title="Today" pad={false}>
          {todays.length ? <BookingTable rows={todays} /> : <Empty title="Nothing booked today">Your next jobs are below.</Empty>}
        </Card>
        <div style={{ height: 12 }} />
        <Card title="Next appointments" pad={false}>
          {list.length ? <BookingTable rows={list.slice(0, 15)} /> : <Empty title="Nothing scheduled yet" />}
        </Card>
      </>
    );
  }

  const [{ data: metricsRows }, { data: todayRows }, { data: unassignedRows }, { data: overdueRows }, { data: owingRows }] =
    await Promise.all([
      supabase.rpc("dashboard_metrics", { p_from: from, p_to: to }),
      supabase.from("booking_view").select("*")
        .gte("starts_at", `${today}T00:00:00`).lte("starts_at", `${today}T23:59:59`)
        .order("starts_at"),
      supabase.from("booking_view").select("*")
        .is("therapist_ids", null).gte("starts_at", `${today}T00:00:00`)
        .not("status", "in", "(cancelled_client,cancelled_business,no_show)")
        .order("starts_at").limit(10),
      supabase.from("enquiry_view").select("*")
        .lt("follow_up_at", new Date().toISOString())
        .not("status", "in", "(booked,lost,spam)")
        .is("archived_at", null).order("follow_up_at").limit(10),
      supabase.from("booking_view").select("*")
        .gt("balance_pesewas", 0)
        .in("status", ["confirmed", "therapist_assigned", "en_route", "arrived", "in_service", "completed"])
        .order("starts_at").limit(10),
    ]);

  const m = (metricsRows?.[0] ?? {}) as Record<string, number>;
  const todays = (todayRows ?? []) as BookingView[];
  const unassigned = (unassignedRows ?? []) as BookingView[];
  const overdue = (overdueRows ?? []) as EnquiryView[];
  const owing = (owingRows ?? []) as BookingView[];
  const conv = m.enquiries_valid ? (m.converted / m.enquiries_valid) * 100 : null;

  return (
    <>
      <PageHead
        title="Dashboard"
        blurb={`${fmtDate(from)} – ${fmtDate(to)}`}
        actions={
          <div className="row">
            {([["Today", 0], ["7 days", -6], ["30 days", -29], ["90 days", -89]] as [string, number][]).map(
              ([label, offset]) => (
                <Link key={label} className="btn sm" href={`/?from=${addDays(today, offset)}&to=${today}`}>
                  {label}
                </Link>
              ),
            )}
          </div>
        }
      />

      <div className="stack" style={{ gap: 8, marginBottom: 14 }}>
        {unassigned.length > 0 && (
          <div className="alert info">
            <span aria-hidden="true">◆</span>
            <span>
              <b>{unassigned.length} upcoming booking{unassigned.length > 1 ? "s have" : " has"} no therapist.</b>{" "}
              Assign before confirming with the client.
            </span>
          </div>
        )}
        {overdue.length > 0 && (
          <div className="alert warn">
            <span aria-hidden="true">⏱</span>
            <span>
              <b>{overdue.length} follow-up{overdue.length > 1 ? "s are" : " is"} overdue.</b>{" "}
              <Link href="/enquiries?status=follow_up">Open enquiries</Link>
            </span>
          </div>
        )}
      </div>

      <div className="kpis" style={{ marginBottom: 14 }}>
        <Kpi label="New enquiries" value={m.enquiries ?? 0} detail={`${m.enquiries_valid ?? 0} excluding spam`} />
        <Kpi label="Bookings created" value={m.bookings_created ?? 0} />
        <Kpi label="Confirmed" value={m.confirmed ?? 0} />
        <Kpi label="Completed" value={m.completed ?? 0} />
        <Kpi label="Cancelled" value={m.cancelled ?? 0} />
        <Kpi label="No-shows" value={m.no_shows ?? 0} />
        <Kpi label="Conversion" value={conv === null ? "—" : `${conv.toFixed(1)}%`} detail="booked ÷ non-spam enquiries" />
        <Kpi label="Collected" value={ghsShort(m.collected_pesewas)} detail="payments net of refunds" />
        <Kpi label="Booked value" value={ghsShort(m.booked_value_pesewas)} />
        <Kpi label="Outstanding" value={ghsShort(m.outstanding_pesewas)} detail="live figure, all time" />
        <Kpi label="Marketing spend" value={ghsShort(m.spend_pesewas)} />
      </div>

      <div className="cols">
        <Card title={`Today · ${fmtDate(today)}`} pad={false}>
          {todays.length ? <BookingTable rows={todays} /> : <Empty title="Nothing booked for today" />}
        </Card>
        <Card title="Unassigned bookings" pad={false}>
          {unassigned.length ? <BookingTable rows={unassigned} /> : <Empty title="Dispatch is clear" />}
        </Card>
        <Card title="Overdue follow-ups" pad={false}>
          {overdue.length ? (
            <div className="tablewrap">
              <table>
                <thead><tr><th>Enquiry</th><th>Name</th><th>Due</th><th>Status</th></tr></thead>
                <tbody>
                  {overdue.map((e) => (
                    <tr key={e.id}>
                      <td className="mono"><Link href={`/enquiries/${e.id}`}>{e.ref}</Link></td>
                      <td>{e.full_name}</td>
                      <td style={{ color: "var(--bad)" }}>{fmtDate(e.follow_up_at)}</td>
                      <td><EnquiryChip status={e.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty title="No overdue follow-ups" />}
        </Card>
        <Card
          title="Outstanding payments"
          pad={false}
          action={<Chip tone="warn">{ghsShort(owing.reduce((t, b) => t + b.balance_pesewas, 0))}</Chip>}
        >
          {owing.length ? (
            <div className="tablewrap">
              <table>
                <thead><tr><th>Booking</th><th>Client</th><th>Appointment</th><th className="r">Balance</th></tr></thead>
                <tbody>
                  {owing.map((b) => (
                    <tr key={b.id}>
                      <td className="mono"><Link href={`/bookings/${b.id}`}>{b.ref}</Link></td>
                      <td>{b.client_name}</td>
                      <td>{fmtDate(b.starts_at)}</td>
                      <td className="r num">{ghs(b.balance_pesewas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty title="Nothing outstanding" />}
        </Card>
      </div>
    </>
  );
}

function BookingTable({ rows }: { rows: BookingView[] }) {
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr><th>Time</th><th>Client</th><th>Service</th><th>Therapist</th><th>Status</th></tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id}>
              <td className="num">
                <Link href={`/bookings/${b.id}`}>{fmtTime(b.starts_at)}</Link>
                <div className="note">{fmtDate(b.starts_at)}</div>
              </td>
              <td>{b.client_name}</td>
              <td>{b.service_name}<div className="note">{b.area}</div></td>
              <td>{b.therapist_names?.join(", ") ?? <Chip tone="warn">Unassigned</Chip>}</td>
              <td><BookingChip status={b.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
