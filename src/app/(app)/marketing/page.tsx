import { requireRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { ghs, ghsShort, fmtDate, todayAccra, addDays, titleise } from "@/lib/format";
import { Card, Empty, PageHead, Kpi, ErrorNote, Field } from "@/components/ui";
import { ga4ReadConfigured, ga4SendConfigured } from "@/lib/ga4";
import { syncGa4, recordSpend, setChannelMap } from "./actions";

export const dynamic = "force-dynamic";

type Row = {
  day: string; channel: string; sessions: number; users: number;
  ga_key_events: number; spend_pesewas: number; impressions: number; clicks: number;
  enquiries: number; booked: number;
  cost_per_booking_pesewas: number | null; enquiry_rate_pct: string | null;
};

export default async function MarketingPage({
  searchParams,
}: { searchParams: { error?: string; ok?: string; days?: string } }) {
  const user = await requireRole("owner", "officer");
  const supabase = supabaseServer();

  const window = Math.min(Math.max(Number(searchParams.days) || 30, 7), 180);
  const from = addDays(todayAccra(), -window);

  const [{ data: perf }, { data: settings }, { data: sources }, { data: map }] = await Promise.all([
    supabase.from("marketing_performance").select("*").gte("day", from).order("day", { ascending: false }),
    supabase.from("settings").select("ga4_property_id, ga4_measurement_id, ga4_last_sync_at").eq("id", true).maybeSingle(),
    supabase.from("lookup_value").select("value, label").eq("kind", "lead_source").order("sort_order"),
    supabase.from("ga4_channel_map").select("*").order("ga4_channel"),
  ]);

  const rows = (perf ?? []) as Row[];
  const isOwner = user.role === "owner";

  // Roll the daily rows up by channel — the day-level detail matters for
  // spotting a spike, the channel totals are what a decision is made on.
  const byChannel = new Map<string, Row>();
  for (const r of rows) {
    const acc = byChannel.get(r.channel) ?? {
      ...r, sessions: 0, users: 0, ga_key_events: 0, spend_pesewas: 0,
      impressions: 0, clicks: 0, enquiries: 0, booked: 0,
      cost_per_booking_pesewas: null, enquiry_rate_pct: null,
    };
    acc.sessions += r.sessions; acc.users += r.users; acc.ga_key_events += r.ga_key_events;
    acc.spend_pesewas += r.spend_pesewas; acc.impressions += r.impressions;
    acc.clicks += r.clicks; acc.enquiries += r.enquiries; acc.booked += r.booked;
    byChannel.set(r.channel, acc);
  }
  const channels = [...byChannel.values()].sort((a, b) => b.booked - a.booked || b.enquiries - a.enquiries);

  const totalSpend = channels.reduce((t, c) => t + c.spend_pesewas, 0);
  const totalBooked = channels.reduce((t, c) => t + c.booked, 0);
  const totalEnq = channels.reduce((t, c) => t + c.enquiries, 0);
  const totalSessions = channels.reduce((t, c) => t + c.sessions, 0);

  return (
    <>
      <PageHead
        title="Marketing"
        blurb={`Website traffic from GA4, what you spent, and the enquiries and bookings that came of it — last ${window} days.`}
      />
      <ErrorNote message={searchParams.error} />
      {searchParams.ok && (
        <div className="alert" style={{ marginBottom: 12 }}><span aria-hidden="true">✓</span><span>{searchParams.ok}</span></div>
      )}

      <div className="kpis" style={{ marginBottom: 14 }}>
        <Kpi label="Sessions" value={totalSessions.toLocaleString()} detail="from GA4" />
        <Kpi label="Enquiries" value={totalEnq} />
        <Kpi label="Booked" value={totalBooked} />
        <Kpi label="Spend" value={ghsShort(totalSpend)} />
        <Kpi
          label="Cost per booking"
          value={totalBooked && totalSpend ? ghs(Math.round(totalSpend / totalBooked)) : "—"}
          detail={totalSpend ? "paid channels only" : "no spend recorded"}
        />
      </div>

      {!ga4ReadConfigured() && (
        <div className="alert warn" style={{ marginBottom: 14 }}>
          <span aria-hidden="true">◔</span>
          <span>
            <b>GA4 is not connected yet.</b> The columns below still work from
            your own enquiry and spend records — the session and rate columns
            stay empty until the property id and service account are set in
            Vercel. Everything else on this page is live.
          </span>
        </div>
      )}

      <Card
        title="By channel"
        action={
          isOwner && ga4ReadConfigured() ? (
            <form action={syncGa4} className="row" style={{ gap: 6 }}>
              <input type="hidden" name="days" value={window} />
              <button className="btn" type="submit">Sync GA4</button>
            </form>
          ) : undefined
        }
        pad={false}
      >
        <div className="tablewrap">
          <table>
            <thead><tr>
              <th>Channel</th>
              <th className="r">Sessions</th><th className="r">Enquiries</th>
              <th className="r">Enquiry rate</th><th className="r">Booked</th>
              <th className="r">Spend</th><th className="r">Cost / booking</th>
            </tr></thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.channel}>
                  <td><b>{titleise(c.channel.replace(/_/g, " "))}</b></td>
                  <td className="r num">{c.sessions ? c.sessions.toLocaleString() : "—"}</td>
                  <td className="r num">{c.enquiries || "—"}</td>
                  <td className="r num">
                    {c.sessions ? `${((c.enquiries / c.sessions) * 100).toFixed(2)}%` : "—"}
                  </td>
                  <td className="r num">{c.booked || "—"}</td>
                  <td className="r num">{c.spend_pesewas ? ghs(c.spend_pesewas) : "—"}</td>
                  <td className="r num">
                    {c.booked && c.spend_pesewas
                      ? <b>{ghs(Math.round(c.spend_pesewas / c.booked))}</b>
                      : c.spend_pesewas ? <span style={{ color: "var(--bad)" }}>no bookings</span> : "—"}
                  </td>
                </tr>
              ))}
              {!channels.length && (
                <tr><td colSpan={7}>
                  <Empty title="Nothing to compare yet">
                    Record what you spent below, and the enquiries you are
                    already logging will line up against it.
                  </Empty>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="cols" style={{ marginTop: 14 }}>
        <Card title="Record spend">
          <form action={recordSpend}>
            <div className="fgrid">
              <Field label="Day" name="day">
                <input className="inp" id="day" name="day" type="date" defaultValue={todayAccra()} required />
              </Field>
              <Field label="Channel" name="platform" hint="Match your lead sources so the numbers line up.">
                <select className="inp" id="platform" name="platform" required defaultValue="instagram_ads">
                  {(sources ?? []).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Campaign" name="campaign" hint="Optional — leave blank for the channel total.">
                <input className="inp" id="campaign" name="campaign" placeholder="accra-massage" />
              </Field>
              <Field label="Spend (GHS)" name="spend">
                <input className="inp num" id="spend" name="spend" placeholder="0.00" required />
              </Field>
              <Field label="Impressions" name="impressions">
                <input className="inp num" id="impressions" name="impressions" type="number" min="0" defaultValue={0} />
              </Field>
              <Field label="Clicks" name="clicks">
                <input className="inp num" id="clicks" name="clicks" type="number" min="0" defaultValue={0} />
              </Field>
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn pri" type="submit">Save spend</button>
            </div>
          </form>
        </Card>

        {isOwner && (
          <Card title="GA4 connection">
            <dl className="meta">
              <dt>Read traffic</dt>
              <dd>{ga4ReadConfigured()
                ? <span style={{ color: "var(--ok)" }}>Connected</span>
                : "Not configured — set GA4_PROPERTY_ID, GA4_SA_CLIENT_EMAIL and GA4_SA_PRIVATE_KEY in Vercel."}</dd>
              <dt>Send bookings</dt>
              <dd>{ga4SendConfigured()
                ? <span style={{ color: "var(--ok)" }}>Connected</span>
                : "Not configured — set GA4_MEASUREMENT_ID and GA4_API_SECRET in Vercel."}</dd>
              <dt>Last sync</dt>
              <dd>{settings?.ga4_last_sync_at ? fmtDate(settings.ga4_last_sync_at) : "Never"}</dd>
            </dl>
            <p className="note" style={{ marginTop: 10 }}>
              Traffic is stored one day at a time and a re-sync replaces the
              days it covers, so running it twice is safe. Today is deliberately
              excluded — GA4 keeps adjusting the current day for hours.
            </p>

            <h4 style={{ marginTop: 16, marginBottom: 6, fontSize: 12.5 }}>Channel names</h4>
            <p className="note" style={{ marginTop: 0 }}>
              GA4 calls it &ldquo;Paid Search&rdquo;; you call it Google Search
              Ads. This is the translation, so one channel is one row.
            </p>
            <div className="tablewrap">
              <table>
                <thead><tr><th>In GA4</th><th>Counts as</th><th></th></tr></thead>
                <tbody>
                  {(map ?? []).map((m) => (
                    <tr key={m.ga4_channel}>
                      <td className="mono">{m.ga4_channel}</td>
                      <td colSpan={2}>
                        <form action={setChannelMap} className="row" style={{ gap: 6 }}>
                          <input type="hidden" name="ga4_channel" value={m.ga4_channel} />
                          <select className="inp" name="crm_source" defaultValue={m.crm_source} style={{ flex: 1 }}>
                            {(sources ?? []).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                          </select>
                          <button className="btn" type="submit">Set</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
