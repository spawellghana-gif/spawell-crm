import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import {
  fmtDate, fmtDateTime, prettyPhone, ghs, waLink, fillTemplate, titleise,
} from "@/lib/format";
import { Card, Field, PageHead, EnquiryChip, Empty, ErrorNote, Chip } from "@/components/ui";
import { ENQUIRY_LABEL, type EnquiryView, type EnquiryStatus } from "@/lib/types";
import { logEvent, setEnquiryStatus, convertToBooking } from "../actions";
import { DangerZone } from "@/components/danger-zone";

export const dynamic = "force-dynamic";

export default async function EnquiryDetail({
  params, searchParams,
}: { params: { id: string }; searchParams: { error?: string } }) {
  const user = await requireRole("owner", "officer");
  const supabase = supabaseServer();

  const { data: enquiry } = await supabase
    .from("enquiry_view").select("*").eq("id", params.id).maybeSingle();
  if (!enquiry) notFound();
  const e = enquiry as EnquiryView;

  const [{ data: events }, { data: dupes }, { data: lostReasons }, { data: template }, { data: zones }] =
    await Promise.all([
      supabase.from("enquiry_event").select("*").eq("enquiry_id", e.id).order("created_at", { ascending: false }),
      supabase.from("enquiry").select("id, ref, status").eq("phone_e164", e.phone_e164).neq("id", e.id),
      supabase.from("lookup_value").select("value, label").eq("kind", "lost_reason").order("sort_order"),
      supabase.from("message_template").select("body").eq("key", "quote").maybeSingle(),
      supabase.from("zone").select("name").order("name"),
    ]);

  const quoteMessage = fillTemplate(template?.body ?? "Hello {name}, ", {
    name: e.full_name.split(" ")[0],
    service: e.service_name ?? "massage",
    duration: String(e.duration_min ?? 60),
    amount: ghs(e.quote_pesewas),
    date: fmtDate(e.preferred_at),
    area: e.area,
    location: e.location_type === "hotel" ? "hotel" : "home",
  });

  return (
    <>
      <PageHead
        title={e.full_name}
        blurb={`${e.ref} · received ${fmtDateTime(e.created_at)}`}
        actions={
          <>
            <a className="btn pri" href={waLink(e.whatsapp_e164 || e.phone_e164, quoteMessage)}
               target="_blank" rel="noopener noreferrer">Open in WhatsApp ↗</a>
            <Link className="btn" href="/enquiries">Back</Link>
          </>
        }
      />
      <ErrorNote message={searchParams.error} />

      <div className="row" style={{ marginBottom: 12 }}>
        <EnquiryChip status={e.status} />
        {e.booking_ref && (
          <Chip tone="ok">Booked · <Link href={`/bookings/${e.booking_id}`}>{e.booking_ref}</Link></Chip>
        )}
        {e.partner_name && <Chip tone="teal">via {e.partner_name}</Chip>}
      </div>

      {!!dupes?.length && (
        <div className="alert warn" style={{ marginBottom: 12 }}>
          <span aria-hidden="true">⚠</span>
          <span>
            <b>This number appears on another enquiry.</b>{" "}
            {dupes.map((d) => (
              <Link key={d.id} href={`/enquiries/${d.id}`} style={{ marginRight: 8 }}>{d.ref}</Link>
            ))}
            Link to the existing client rather than creating a second record.
          </span>
        </div>
      )}

      <div className="cols">
        <Card title="Details">
          <dl className="meta">
            <dt>Phone</dt><dd className="mono">{prettyPhone(e.phone_e164)}</dd>
            <dt>Channel · source</dt><dd>{titleise(e.channel)} · {titleise(e.source)}</dd>
            <dt>Campaign</dt><dd>{e.campaign || "—"}</dd>
            <dt>Service</dt>
            <dd>{e.service_name ?? "Not chosen"} · {e.duration_min ?? "—"} min · {e.guests} guest{e.guests > 1 ? "s" : ""}</dd>
            <dt>Preferred</dt><dd>{fmtDateTime(e.preferred_at)}</dd>
            <dt>Where</dt>
            <dd>{titleise(e.location_type)} · {e.area}<div className="note">{e.address}{e.landmark ? ` · ${e.landmark}` : ""}</div></dd>
            <dt>Quote</dt><dd className="num">{e.quote_pesewas ? ghs(e.quote_pesewas) : "—"}</dd>
            <dt>Owner</dt><dd>{e.owner_name ?? "—"}</dd>
            <dt>Next follow-up</dt><dd>{fmtDateTime(e.follow_up_at)}</dd>
            {e.lost_reason && <><dt>Lost reason</dt><dd>{titleise(e.lost_reason)}</dd></>}
          </dl>
          {e.notes && <p className="note" style={{ marginTop: 12 }}>{e.notes}</p>}
        </Card>

        {e.status !== "booked" && (
          <Card title="Convert to a booking">
            <p className="note" style={{ marginTop: 0 }}>
              Creates the client if they are new, creates the booking, and keeps
              the source and campaign attached so attribution survives.
            </p>
            <form action={convertToBooking} className="stack" style={{ gap: 11, marginTop: 10 }}>
              <input type="hidden" name="enquiry_id" value={e.id} />
              <div className="fgrid">
                <Field label="Start" name="starts_at">
                  <input className="inp" id="starts_at" name="starts_at" type="datetime-local"
                    defaultValue={e.preferred_at ? e.preferred_at.slice(0, 16) : undefined} required />
                </Field>
                <Field label="Duration (minutes)" name="duration_min">
                  <input className="inp num" id="duration_min" name="duration_min" type="number"
                    defaultValue={e.duration_min ?? 60} min={15} step={15} />
                </Field>
                <Field label="Price (GHS)" name="base"
                  hint="All-inclusive — travel is not charged separately.">
                  <input className="inp num" id="base" name="base" type="number" step="0.01"
                    defaultValue={(e.quote_pesewas / 100).toFixed(2)} />
                </Field>
              </div>
              <button className="btn sand" type="submit" style={{ justifyContent: "center" }}>
                Convert to booking
              </button>
            </form>
          </Card>
        )}

        <Card title="Log an interaction">
          <form action={logEvent} className="stack" style={{ gap: 11 }}>
            <input type="hidden" name="enquiry_id" value={e.id} />
            <div className="fgrid">
              <Field label="Type" name="type">
                <select className="inp" id="type" name="type" defaultValue="whatsapp">
                  <option value="whatsapp">WhatsApp</option>
                  <option value="call">Call</option>
                  <option value="note">Note</option>
                  <option value="quote">Quote</option>
                </select>
              </Field>
              <Field label="Move status to" name="next_status">
                <select className="inp" id="next_status" name="next_status" defaultValue="">
                  <option value="">Leave as {ENQUIRY_LABEL[e.status]}</option>
                  {(["contacted", "qualified", "quoted", "follow_up"] as EnquiryStatus[]).map((k) => (
                    <option key={k} value={k}>{ENQUIRY_LABEL[k]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Next follow-up" name="follow_up_at">
                <input className="inp" id="follow_up_at" name="follow_up_at" type="datetime-local" />
              </Field>
            </div>
            <Field label="What happened" name="body">
              <input className="inp" id="body" name="body" required
                placeholder="Called, no answer — try again this evening" />
            </Field>
            <button className="btn pri" type="submit">Log it</button>
          </form>

          <form action={setEnquiryStatus} className="row" style={{ marginTop: 14 }}>
            <input type="hidden" name="enquiry_id" value={e.id} />
            {e.status === "lost" ? (
              <>
                <input type="hidden" name="status" value="follow_up" />
                <button className="btn" type="submit">Reopen this enquiry</button>
              </>
            ) : (
              <>
                <input type="hidden" name="status" value="lost" />
                <select className="inp" name="lost_reason" style={{ maxWidth: 200 }} defaultValue="price">
                  {(lostReasons ?? []).map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <button className="btn danger" type="submit">Mark lost</button>
              </>
            )}
          </form>
        </Card>

        <Card title="Conversation">
          {events?.length ? (
            <ul className="tl">
              {events.map((ev) => (
                <li key={ev.id}>
                  <time>{fmtDateTime(ev.created_at)} · {titleise(ev.type)}</time>
                  {ev.body}
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Nothing logged yet">Log the first call or message on the left.</Empty>
          )}
        </Card>
      </div>

      {user.role === "owner" && (
        <DangerZone table="enquiry" id={enquiry.id} label="enquiry"
                    from={`/enquiries/${enquiry.id}`}>
          Removes the enquiry and its whole conversation log. Any booking that
          came from it survives, but loses the record of where it came from —
          so your channel and partner figures shift.
        </DangerZone>
      )}
    </>
  );
}
