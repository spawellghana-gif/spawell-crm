import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, isStaff } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import {
  fmtDate, fmtDateTime, fmtTime, ghs, prettyPhone, waLink, fillTemplate, titleise,
} from "@/lib/format";
import { Card, Field, PageHead, BookingChip, Empty, ErrorNote, Chip } from "@/components/ui";
import {
  BOOKING_FLOW, THERAPIST_STATUSES, STATUS_LABEL,
  type BookingView, type Therapist, type Availability,
} from "@/lib/types";
import { setBookingStatus, assignTherapist, recordPayment, rescheduleBooking } from "../actions";
import { DangerZone, DeleteRowButton } from "@/components/danger-zone";
import { Acquisition } from "@/components/acquisition";

export const dynamic = "force-dynamic";

export default async function BookingDetail({
  params, searchParams,
}: { params: { id: string }; searchParams: { error?: string; warn?: string; pending?: string; deleted?: string } }) {
  const user = await requireUser();
  const supabase = supabaseServer();

  const { data: row } = await supabase
    .from("booking_view").select("*").eq("id", params.id).maybeSingle();
  if (!row) notFound();
  const b = row as BookingView;
  // Attribution and its conversion, read alongside the booking rather than
  // inside it: a booking must still render if either returns nothing.
  const [{ data: conversion }, { data: bookingAd }] = await Promise.all([
    supabase.from("conversion_event")
      .select("status, value_pesewas, dedup_key, last_attempt_at, skip_reason, revision")
      .eq("booking_id", b.id).maybeSingle(),
    supabase.from("booking")
      .select("gclid, gbraid, wbraid, source, campaign")
      .eq("id", b.id).maybeSingle(),
  ]);
  const staff = isStaff(user.role);

  const [{ data: events }, { data: payments }, { data: therapists }, { data: methods }, { data: templates }, { data: lostReasons }] =
    await Promise.all([
      supabase.from("booking_event").select("*").eq("booking_id", b.id).order("created_at", { ascending: false }),
      supabase.from("payment").select("*").eq("booking_id", b.id).order("received_at", { ascending: false }),
      staff
        ? supabase.from("therapist").select("*").eq("active", true).is("archived_at", null).order("full_name")
        : Promise.resolve({ data: [] as Therapist[] }),
      supabase.from("lookup_value").select("value, label").eq("kind", "payment_method").order("sort_order"),
      supabase.from("message_template").select("key, name, body").order("key"),
      supabase.from("lookup_value").select("value, label").eq("kind", "lost_reason").order("sort_order"),
    ]);

  // Availability for each therapist, decided by the database.
  const availability: Record<string, Availability> = {};
  if (staff) {
    await Promise.all(
      (therapists ?? []).map(async (t: Therapist) => {
        const { data } = await supabase.rpc("therapist_availability", {
          p_therapist: t.id, p_starts: b.starts_at, p_ends: b.ends_at,
          p_buffer_before: b.buffer_before_min, p_buffer_after: b.buffer_after_min,
          p_ignore_booking: b.id,
        });
        availability[t.id] = data?.[0] ?? { available: false, reason: "Unknown" };
      }),
    );
  }

  const flowIndex = BOOKING_FLOW.indexOf(b.status);
  const nextStatus = flowIndex >= 0 && flowIndex < BOOKING_FLOW.length - 1 ? BOOKING_FLOW[flowIndex + 1] : null;
  const allowedStatuses = staff ? BOOKING_FLOW.slice(2) : THERAPIST_STATUSES;

  const vars = {
    name: b.client_name.split(" ")[0], service: b.service_name,
    duration: String(b.duration_min), amount: ghs(b.total_pesewas),
    date: fmtDate(b.starts_at), time: fmtTime(b.starts_at),
    therapist: b.therapist_names?.[0] ?? "your therapist",
    area: b.area, location: b.location_type === "hotel" ? "hotel" : "home",
    balance: ghs(b.balance_pesewas), booking: b.ref,
  };

  return (
    <>
      <PageHead
        title={b.client_name}
        blurb={`${b.ref} · ${b.service_name} · ${fmtDateTime(b.starts_at)}`}
        actions={<Link className="btn" href="/bookings">Back</Link>}
      />
      <ErrorNote message={searchParams.error} />
      {searchParams.deleted === "payment" && (
        <p className="alert ok" role="status">Payment deleted. Totals have been updated.</p>
      )}

      {searchParams.warn && searchParams.pending && (
        <div className="alert warn" style={{ marginBottom: 12 }}>
          <span aria-hidden="true">⚠</span>
          <span style={{ flex: 1 }}>
            <b>{searchParams.warn}.</b> Assign anyway only if you know the therapist can make it.
          </span>
          <form action={assignTherapist}>
            <input type="hidden" name="booking_id" value={b.id} />
            <input type="hidden" name="therapist_id" value={searchParams.pending} />
            <input type="hidden" name="assign" value="1" />
            <input type="hidden" name="force" value="1" />
            <button className="btn sm danger" type="submit">Assign anyway</button>
          </form>
        </div>
      )}

      <div className="row" style={{ marginBottom: 12 }}>
        <BookingChip status={b.status} />
        <Chip tone={b.payment_status === "paid" ? "ok" : b.payment_status === "unpaid" ? "bad" : "warn"}>
          {titleise(b.payment_status)}
        </Chip>
        {!b.therapist_ids?.length && <Chip tone="warn">Unassigned</Chip>}
        {b.partner_name && <Chip tone="teal">via {b.partner_name}</Chip>}
      </div>

      <div className="cols">
        <Card title="Appointment">
          <dl className="meta">
            <dt>When</dt>
            <dd>{fmtDate(b.starts_at)} · <span className="num">{fmtTime(b.starts_at)} – {fmtTime(b.ends_at)}</span>
              <div className="note">Travel buffer {b.buffer_before_min}m before, {b.buffer_after_min}m after</div></dd>
            <dt>Service</dt><dd>{b.service_name} · {b.duration_min} min · {b.guests} guest{b.guests > 1 ? "s" : ""}</dd>
            <dt>Where</dt>
            <dd>{b.location_type === "hotel" ? `${b.hotel_name} · room ${b.room_no}` : b.address || b.area}
              <div className="note">{b.area}, {b.city}{b.landmark ? ` · ${b.landmark}` : ""}</div></dd>
            <dt>Client</dt>
            <dd>{b.client_name}<div className="note mono">{prettyPhone(b.client_phone)}</div></dd>
            <dt>Therapist</dt><dd>{b.therapist_names?.join(", ") ?? "Unassigned"}</dd>
            {staff && (
              <>
                <dt>Money</dt>
                <dd className="num">
                  <b>{ghs(b.total_pesewas)}</b> total · {ghs(b.paid_pesewas)} paid ·{" "}
                  <b style={{ color: b.balance_pesewas > 0 ? "var(--bad)" : "var(--ok)" }}>
                    {ghs(b.balance_pesewas)}
                  </b>{" "}
                  outstanding
                  <div className="note">
                    Service {ghs(b.base_pesewas)} · transport {ghs(b.transport_pesewas)}
                    {b.addons_pesewas > 0 && ` · add-ons ${ghs(b.addons_pesewas)}`}
                    {b.discount_pesewas > 0 && ` · discount −${ghs(b.discount_pesewas)}`}
                  </div>
                </dd>
              </>
            )}
            <dt>Consent</dt>
            <dd>{b.consent_confirmed ? <Chip tone="ok">Confirmed</Chip> : <Chip tone="warn">Not confirmed</Chip>}</dd>
          </dl>
          {b.instructions_client && <p className="note" style={{ marginTop: 12 }}>{b.instructions_client}</p>}
        </Card>

        <Card title="Move it along">
          <form action={setBookingStatus} className="row">
            <input type="hidden" name="booking_id" value={b.id} />
            {nextStatus && allowedStatuses.includes(nextStatus) && (
              <button className="btn pri" name="status" value={nextStatus} type="submit">
                Mark {STATUS_LABEL[nextStatus].toLowerCase()}
              </button>
            )}
            {allowedStatuses.map((st) => (
              <button key={st} className={`btn sm ${b.status === st ? "pri" : ""}`}
                name="status" value={st} type="submit">
                {STATUS_LABEL[st]}
              </button>
            ))}
          </form>

          {staff && (
            <form action={setBookingStatus} className="row" style={{ marginTop: 14 }}>
              <input type="hidden" name="booking_id" value={b.id} />
              <input type="hidden" name="status" value="cancelled_client" />
              <select className="inp" name="cancel_reason" style={{ maxWidth: 180 }} defaultValue="changed_mind">
                {(lostReasons ?? []).map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <input className="inp num" name="cancel_fee" type="number" step="0.01"
                placeholder="Fee GHS" style={{ maxWidth: 120 }} />
              <button className="btn danger" type="submit">Cancel booking</button>
            </form>
          )}

          {staff && (
            <form action={rescheduleBooking} className="row" style={{ marginTop: 14 }}>
              <input type="hidden" name="booking_id" value={b.id} />
              <input className="inp" name="starts_at" type="datetime-local"
                defaultValue={b.starts_at.slice(0, 16)} style={{ maxWidth: 220 }} />
              <input type="hidden" name="duration_min" value={b.duration_min} />
              <input className="inp" name="reason" placeholder="Reason" style={{ maxWidth: 180 }} />
              <button className="btn" type="submit">Reschedule</button>
            </form>
          )}
        </Card>

        {staff && (
          <Card title="Dispatch">
            <div className="stack" style={{ gap: 6 }}>
              {(therapists ?? []).map((t: Therapist) => {
                const assigned = b.therapist_ids?.includes(t.id) ?? false;
                const avail = availability[t.id];
                return (
                  <form key={t.id} action={assignTherapist}
                    className="row"
                    style={{
                      gap: 9, padding: "7px 9px", border: "1px solid var(--line)",
                      borderRadius: "var(--rs)",
                      background: assigned ? "var(--teal-soft)" : "var(--card)",
                    }}>
                    <input type="hidden" name="booking_id" value={b.id} />
                    <input type="hidden" name="therapist_id" value={t.id} />
                    <input type="hidden" name="assign" value={assigned ? "0" : "1"} />
                    <span style={{ flex: 1 }}>
                      <b>{t.full_name}</b>
                      <div className="note">{titleise(t.gender)} · {t.base_area} · {t.work_start.slice(0, 5)}–{t.work_end.slice(0, 5)}</div>
                    </span>
                    {assigned
                      ? <Chip tone="teal">Assigned</Chip>
                      : avail?.available
                        ? <Chip tone="ok">Available</Chip>
                        : <Chip tone="bad">{avail?.reason ?? "—"}</Chip>}
                    <button className="btn sm" type="submit">{assigned ? "Remove" : "Assign"}</button>
                  </form>
                );
              })}
            </div>
            <p className="note" style={{ marginTop: 8 }}>
              Availability comes from the database — working days, hours, time off,
              the daily maximum and travel buffers — so any client of the API gets
              the same answer.
            </p>
          </Card>
        )}

        <Card title="Payments">
          <form action={recordPayment} className="row">
            <input type="hidden" name="booking_id" value={b.id} />
            <select className="inp" name="kind" style={{ maxWidth: 120 }} defaultValue="balance">
              <option value="deposit">Deposit</option>
              <option value="balance">Balance</option>
              {staff && <option value="refund">Refund</option>}
            </select>
            <input className="inp num" name="amount" type="number" step="0.01" min="0"
              placeholder="Amount GHS" style={{ maxWidth: 130 }}
              defaultValue={b.balance_pesewas ? (b.balance_pesewas / 100).toFixed(2) : ""} required />
            <select className="inp" name="method" style={{ maxWidth: 150 }} defaultValue="mobile_money">
              {(methods ?? []).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <input className="inp" name="provider_ref" placeholder="Reference" style={{ maxWidth: 140 }} />
            <button className="btn pri" type="submit">Record</button>
          </form>

          <div className="tablewrap" style={{ marginTop: 12 }}>
            {payments?.length ? (
              <table>
                <thead><tr><th>Ref</th><th>Type</th><th>Method</th><th>When</th><th className="r">Amount</th>
                  {user.role === "owner" && <th className="r">Test payment</th>}
                </tr></thead>
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
                      {user.role === "owner" && (
                        <td>
                          <DeleteRowButton table="payment" id={p.id}
                            label={`test payment ${p.ref}`} from={`/bookings/${b.id}`} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty title="No payments yet">Record the deposit when the client sends it.</Empty>}
          </div>
          {user.role === "owner" && Boolean(payments?.length) && (
            <p className="note" style={{ marginTop: 8 }}>
              To remove a test payment, type DELETE beside its row. This permanently
              removes the record; it does not send a refund.
            </p>
          )}
          <p className="note" style={{ marginTop: 8 }}>
            No card details are stored. Amounts, methods and the provider&rsquo;s reference only.
          </p>
        </Card>

        {staff && (
          <Card title="WhatsApp">
            <div className="row">
              {(templates ?? []).map((t) => (
                <a key={t.key} className="btn sm"
                   href={waLink(b.client_whatsapp || b.client_phone, fillTemplate(t.body, vars))}
                   target="_blank" rel="noopener noreferrer">
                  {t.name} ↗
                </a>
              ))}
            </div>
            <p className="note" style={{ marginTop: 8 }}>
              Opens WhatsApp with the message prefilled. Nothing is sent from here
              until the Cloud API is wired up.
            </p>
          </Card>
        )}

        <Card title="History">
          {events?.length ? (
            <ul className="tl">
              {events.map((ev) => (
                <li key={ev.id}><time>{fmtDateTime(ev.created_at)}</time>{ev.body}</li>
              ))}
            </ul>
          ) : <Empty title="Nothing logged yet" />}
        </Card>
      </div>

      <div style={{ marginTop: 14 }}>
        <Acquisition
          source={bookingAd?.source}
          campaign={bookingAd?.campaign}
          gclid={bookingAd?.gclid}
          gbraid={bookingAd?.gbraid}
          wbraid={bookingAd?.wbraid}
          status={(bookingAd?.gclid || bookingAd?.gbraid || bookingAd?.wbraid) ? "google_ads" : undefined}
          conversion={conversion ?? null}
          showTechnical={user.role === "owner"}
        />
      </div>

      {user.role === "owner" && (
        <DangerZone table="booking" id={b.id} label="booking"
                    from={`/bookings/${b.id}`}
                    warning={"Cancelling is almost always the better move — it keeps the job in the record with a reason attached."}>
          Removes {b.ref} along with its status history and therapist
          assignment. If any payment has been recorded against it the database
          will refuse, because deleting it would change what the month
          collected.
        </DangerZone>
      )}
    </>
  );
}
