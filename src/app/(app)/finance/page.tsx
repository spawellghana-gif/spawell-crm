import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { ghs, ghsShort, fmtDate, todayAccra, addDays, titleise } from "@/lib/format";
import { Card, Empty, PageHead, Kpi } from "@/components/ui";
import type { BookingView } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function FinancePage({
  searchParams,
}: { searchParams: { from?: string; to?: string } }) {
  await requireRole("owner", "officer");
  const supabase = supabaseServer();
  const today = todayAccra();
  const from = searchParams.from ?? addDays(today, -29);
  const to = searchParams.to ?? today;

  const [{ data: payments }, { data: expenses }, { data: owing }] = await Promise.all([
    supabase.from("payment").select("*")
      .gte("received_at", `${from}T00:00:00`).lte("received_at", `${to}T23:59:59`)
      .order("received_at", { ascending: false }),
    supabase.from("expense").select("*").gte("spent_on", from).lte("spent_on", to)
      .order("spent_on", { ascending: false }),
    supabase.from("booking_view").select("*").gt("balance_pesewas", 0)
      .in("status", ["confirmed", "therapist_assigned", "en_route", "arrived", "in_service", "completed"])
      .order("starts_at"),
  ]);

  const collected = (payments ?? []).reduce((t, p) => t + p.amount_pesewas, 0);
  const spent = (expenses ?? []).reduce((t, e) => t + e.amount_pesewas, 0);
  const outstanding = ((owing ?? []) as BookingView[]).reduce((t, b) => t + b.balance_pesewas, 0);

  const byCategory = new Map<string, number>();
  (expenses ?? []).forEach((e) => byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount_pesewas));

  return (
    <>
      <PageHead
        title="Finance"
        blurb="An operational money view for running the week — not a substitute for your accountant's books."
        actions={
          <form className="row">
            <input className="inp" type="date" name="from" defaultValue={from} />
            <input className="inp" type="date" name="to" defaultValue={to} />
            <button className="btn" type="submit">Apply</button>
          </form>
        }
      />

      <div className="kpis" style={{ marginBottom: 14 }}>
        <Kpi label="Collected" value={ghsShort(collected)} detail="net of refunds" />
        <Kpi label="Operating expenses" value={ghsShort(spent)} />
        <Kpi label="Gross margin" value={ghsShort(collected - spent)} detail="cash view for the period" />
        <Kpi label="Outstanding" value={ghsShort(outstanding)} detail="all time, unsettled bookings" />
      </div>

      <div className="cols">
        <Card title="Payments received" pad={false}>
          <div className="tablewrap">
            {payments?.length ? (
              <table>
                <thead><tr><th>Ref</th><th>Type</th><th>Method</th><th>When</th><th className="r">Amount</th></tr></thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="mono">{p.provider_ref || p.ref}</td>
                      <td>{titleise(p.kind)}</td>
                      <td>{titleise(p.method)}</td>
                      <td>{fmtDate(p.received_at)}</td>
                      <td className="r num" style={{ color: p.amount_pesewas < 0 ? "var(--bad)" : undefined }}>
                        {ghs(p.amount_pesewas)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty title="No payments in this range" />}
          </div>
        </Card>

        <Card title="Expenses" pad={false}>
          <div className="tablewrap">
            {expenses?.length ? (
              <table>
                <thead><tr><th>Date</th><th>Category</th><th>Vendor</th><th className="r">Amount</th></tr></thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id}>
                      <td>{fmtDate(e.spent_on)}</td>
                      <td>{titleise(e.category)}</td>
                      <td>{e.vendor}</td>
                      <td className="r num">{ghs(e.amount_pesewas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty title="No expenses in this range" />}
          </div>
        </Card>

        <Card title="Where the money went">
          {byCategory.size ? (
            <div className="stack" style={{ gap: 8 }}>
              {[...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([cat, amount]) => (
                <div key={cat}>
                  <div className="row" style={{ justifyContent: "space-between", fontSize: 12.5 }}>
                    <span>{titleise(cat)}</span><span className="num">{ghs(amount)}</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: "var(--neutral-bg)", marginTop: 4 }}>
                    <div style={{ height: "100%", borderRadius: 4, background: "var(--teal)",
                      width: `${Math.round((amount / spent) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : <Empty title="Nothing recorded yet" />}
        </Card>

        <Card title="Outstanding balances" pad={false}>
          <div className="tablewrap">
            {owing?.length ? (
              <table>
                <thead><tr><th>Booking</th><th>Client</th><th>Appointment</th><th className="r">Balance</th></tr></thead>
                <tbody>
                  {(owing as BookingView[]).map((b) => (
                    <tr key={b.id}>
                      <td className="mono"><Link href={`/bookings/${b.id}`}>{b.ref}</Link></td>
                      <td>{b.client_name}</td>
                      <td>{fmtDate(b.starts_at)}</td>
                      <td className="r num">{ghs(b.balance_pesewas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty title="Everything is settled" />}
          </div>
        </Card>
      </div>
    </>
  );
}
