import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { ghs, ghsShort, fmtDate, fmtDateTime, todayAccra, addDays } from "@/lib/format";
import { Card, Empty, PageHead, Kpi, Chip, ErrorNote } from "@/components/ui";
import { googleAdsMissing, googleAdsConfig } from "@/lib/google-ads";
import { prepareGoogleAdsRuntime } from "@/lib/google-ads-runtime";
import { retryConversions, validateConversions, backfillConversions, toggleSync } from "./actions";

export const dynamic = "force-dynamic";

const RANGES: [string, string, number][] = [
  ["today", "Today", 0],
  ["yesterday", "Yesterday", 1],
  ["7", "Last 7 days", 7],
  ["30", "Last 30 days", 30],
  ["90", "Last 90 days", 90],
];

const STATUS_TONE: Record<string, string> = {
  synced: "ok", pending: "warn", sending: "info", failed: "bad", skipped: "", void: "",
};

export default async function GoogleAdsPage({
  searchParams,
}: {
  searchParams: { error?: string; ok?: string; range?: string; from?: string; to?: string; status?: string };
}) {
  const user = await requireRole("owner", "officer");
  const supabase = supabaseServer();
  const isOwner = user.role === "owner";

  const rangeKey = searchParams.range ?? "30";
  const today = todayAccra();
  const preset = RANGES.find((r) => r[0] === rangeKey);
  const from = searchParams.from ?? (rangeKey === "yesterday" ? addDays(today, -1) : addDays(today, -Math.max((preset?.[2] ?? 30) - 1, 0)));
  const to = searchParams.to ?? (rangeKey === "yesterday" ? addDays(today, -1) : today);

  const [{ data: enquiries, error: enquiriesError }, { data: bookings, error: bookingsError },
    { data: conversions, error: conversionsError }, { data: settings, error: settingsError }] =
    await Promise.all([
      supabase.from("enquiry")
        .select("id, ref, status, ad_attribution_status, first_touch_at, created_at, campaign")
        .gte("created_at", `${from}T00:00:00Z`).lte("created_at", `${to}T23:59:59Z`),
      supabase.from("booking")
        .select("id, ref, status, total_pesewas, gclid, gbraid, wbraid, source, confirmed_at, starts_at")
        .gte("starts_at", `${from}T00:00:00Z`).lte("starts_at", `${to}T23:59:59Z`),
      supabase.from("conversion_event")
        .select("*, booking:booking_id(ref, status)")
        .order("created_at", { ascending: false }).limit(100),
      supabase.from("settings").select("google_ads_sync_enabled").eq("id", true).maybeSingle(),
    ]);

  if (enquiriesError || bookingsError || conversionsError || settingsError) {
    return <>
      <PageHead title="Google Ads attribution" actions={<Link className="btn" href="/marketing">Marketing</Link>} />
      <ErrorNote message="Google Ads reporting is not available yet. Complete the database setup before using this page." />
    </>;
  }

  // Load the non-secret Ads account/action IDs from CRM settings and reuse the
  // existing GA4 service-account env vars when available. This makes the page
  // report the actual remaining connection state instead of only raw env vars.
  const prepared = await prepareGoogleAdsRuntime(supabase);

  const enq = enquiries ?? [];
  const bk = bookings ?? [];
  const conv = conversions ?? [];

  const googleEnq = enq.filter((e) => e.ad_attribution_status === "google_ads");
  const googleBk = bk.filter((b) => b.gclid || b.gbraid || b.wbraid || b.source === "google_search_ads");
  const CONFIRMED_ON = ["confirmed", "therapist_assigned", "en_route", "arrived", "in_service", "completed", "paid"];
  const confirmed = googleBk.filter((b) => CONFIRMED_ON.includes(b.status));
  const completed = googleBk.filter((b) => b.status === "completed" || b.status === "paid");
  const revenue = confirmed.reduce((t, b) => t + (b.total_pesewas ?? 0), 0);

  const byStatus = (s: string) => conv.filter((c) => c.status === s).length;
  const missing = prepared.ok ? googleAdsMissing() : [prepared.reason];
  const cfg = googleAdsConfig();
  const syncOn = Boolean(settings?.google_ads_sync_enabled) && cfg.syncEnabled;

  const filtered = searchParams.status ? conv.filter((c) => c.status === searchParams.status) : conv;

  return (
    <>
      <PageHead
        title="Google Ads attribution"
        blurb="Connect advertising enquiries to confirmed bookings and revenue."
        actions={<Link className="btn" href="/marketing">Marketing</Link>}
      />
      <ErrorNote message={searchParams.error} />
      {searchParams.ok && (
        <div className="alert" style={{ marginBottom: 12 }}><span aria-hidden="true">✓</span><span>{searchParams.ok}</span></div>
      )}

      {missing.length > 0 && (
        <div className="alert warn" style={{ marginBottom: 14 }}>
          <span aria-hidden="true">◔</span>
          <span>
            <b>Google Ads is not connected yet.</b> Remaining: {missing.join(", ")}.
            Confirmed bookings stay safely queued until these are available.
          </span>
        </div>
      )}

      <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {RANGES.map(([key, label]) => (
          <Link key={key} className={`btn${rangeKey === key ? " pri" : ""}`}
                href={`/marketing/google-ads?range=${key}`}>{label}</Link>
        ))}
        <form className="row" style={{ gap: 6, marginLeft: "auto" }}>
          <input className="inp" type="date" name="from" defaultValue={from} aria-label="From" />
          <input className="inp" type="date" name="to" defaultValue={to} aria-label="To" />
          <button className="btn" type="submit">Apply</button>
        </form>
      </div>

      <div className="kpis" style={{ marginBottom: 14 }}>
        <Kpi label="Google Ads leads" value={googleEnq.length} detail={`of ${enq.length} enquiries`} />
        <Kpi label="Confirmed bookings" value={confirmed.length} detail="attributed to Google Ads" />
        <Kpi label="Completed services" value={completed.length} />
        <Kpi
          label="Lead → booking"
          value={googleEnq.length ? `${((confirmed.length / googleEnq.length) * 100).toFixed(0)}%` : "—"}
        />
        <Kpi label="Attributed revenue" value={ghsShort(revenue)} />
        <Kpi
          label="Average booking"
          value={confirmed.length ? ghs(Math.round(revenue / confirmed.length)) : "—"}
        />
      </div>

      <Card
        title="Conversion queue"
        action={
          isOwner ? (
            <div className="row" style={{ gap: 6 }}>
              <form action={toggleSync}>
                <input type="hidden" name="enabled" value={syncOn ? "false" : "true"} />
                <button className="btn" type="submit">{syncOn ? "Pause sync" : "Enable sync"}</button>
              </form>
              <form action={validateConversions}><button className="btn" type="submit">Validate</button></form>
              <form action={retryConversions}><button className="btn pri" type="submit">Sync now</button></form>
            </div>
          ) : undefined
        }
      >
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {["synced", "pending", "failed", "skipped", "void"].map((s) => (
            <Link key={s} className={`btn${searchParams.status === s ? " pri" : ""}`}
                  href={`/marketing/google-ads?range=${rangeKey}&status=${s}`}>
              {s} · {byStatus(s)}
            </Link>
          ))}
          {searchParams.status && (
            <Link className="btn" href={`/marketing/google-ads?range=${rangeKey}`}>Clear</Link>
          )}
        </div>
        <p className="note" style={{ marginTop: 0 }}>
          <b>Skipped</b> means the booking had no advertising evidence, so no
          conversion was created for it. <b>Void</b> means it was cancelled in
          the CRM. Previously uploaded conversions remain in Google. Sync is currently{" "}
          <b>{syncOn ? "on" : "off"}</b>
          {!syncOn && " — sending is paused"}.
        </p>
      </Card>

      <Card title="Conversions" pad={false}>
        <div className="tablewrap" style={{ maxHeight: 460, overflowY: "auto" }}>
          <table>
            <thead><tr>
              <th>Transaction ID</th><th>Booking</th><th>Confirmed</th>
              <th className="r">Value</th><th>Match</th><th>Status</th>
              <th className="r">Tries</th>{isOwner && <th className="r"></th>}
            </tr></thead>
            <tbody>
              {filtered.map((c: any) => (
                <tr key={c.id}>
                  <td className="mono">{c.dedup_key}</td>
                  <td className="mono">
                    <Link href={`/bookings/${c.booking_id}`}>{c.booking?.ref ?? "—"}</Link>
                  </td>
                  <td>{fmtDate(c.conversion_at)}</td>
                  <td className="r num">{ghs(c.value_pesewas)}</td>
                  <td className="note">
                    {c.gclid ? "GCLID" : c.gbraid ? "GBRAID" : c.wbraid ? "WBRAID"
                      : c.phone_sha256 ? "Phone (hashed)" : "—"}
                  </td>
                  <td>
                    <Chip tone={STATUS_TONE[c.status] ?? ""}>{c.status}</Chip>
                    {c.skip_reason && <div className="note">{c.skip_reason}</div>}
                    {c.error_detail && <div className="note" style={{ color: "var(--bad)" }}>{c.error_detail.slice(0, 90)}</div>}
                    {c.revision > 1 && <div className="note">reconfirmed ×{c.revision} — reported once</div>}
                  </td>
                  <td className="r num">{c.attempts}</td>
                  {isOwner && (
                    <td className="r">
                      {(c.status === "failed" || c.status === "pending") && (
                        <form action={retryConversions}>
                          <input type="hidden" name="conversion_id" value={c.id} />
                          <button className="btn" type="submit">Retry</button>
                        </form>
                      )}
                      {c.status === "synced" && c.last_attempt_at && (
                        <span className="note">{fmtDateTime(c.last_attempt_at)}</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={isOwner ? 8 : 7}>
                  <Empty title="No conversions yet">
                    A conversion is created the moment a booking is set to
                    Confirmed. If you have confirmed bookings from before this
                    was installed, use Backfill below.
                  </Empty>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {isOwner && (
        <div style={{ marginTop: 14 }}>
          <Card title="Maintenance">
            <p className="note" style={{ marginTop: 0 }}>
              Backfill checks up to 500 confirmed bookings with a recorded
              confirmation time and creates missing conversion records.
              Existing records keep their original transaction ID.
            </p>
            <form action={backfillConversions}>
              <button className="btn" type="submit">Backfill confirmed bookings</button>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
