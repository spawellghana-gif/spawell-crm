import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { ghs, ghsShort, prettyPhone, prettyWhatsAppUsername, fmtDate, fmtDateTime, waLink, titleise } from "@/lib/format";
import { Card, Empty, PageHead, Kpi, BookingChip, Chip, ErrorNote } from "@/components/ui";
import { DangerZone } from "@/components/danger-zone";
import type { BookingView } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ClientDetail({
  params, searchParams,
}: { params: { id: string }; searchParams: { error?: string } }) {
  const user = await requireRole("owner", "officer");
  const supabase = supabaseServer();

  const { data: c } = await supabase.from("client_view").select("*").eq("id", params.id).maybeSingle();
  if (!c) notFound();

  const [{ data: bookings }, { data: enquiries }] = await Promise.all([
    supabase.from("booking_view").select("*").eq("client_id", c.id).order("starts_at", { ascending: false }),
    supabase.from("enquiry_view").select("*").eq("client_id", c.id).order("created_at", { ascending: false }),
  ]);
  const rows = (bookings ?? []) as BookingView[];
  const whatsappNumber = c.whatsapp_e164 || c.phone_e164;

  return (
    <>
      <PageHead
        title={c.full_name}
        blurb={`${c.area}${c.address ? ` · ${c.address}` : ""}`}
        actions={
          <>
            {whatsappNumber && (
              <a className="btn pri" href={waLink(whatsappNumber, `Hello ${c.full_name.split(" ")[0]}, this is SpaWellGhana. `)}
                 target="_blank" rel="noopener noreferrer">Open in WhatsApp ↗</a>
            )}
            <Link className="btn" href="/clients">Back</Link>
          </>
        }
      />
      <ErrorNote message={searchParams.error} />
      <div className="kpis" style={{ marginBottom: 14 }}>
        <Kpi label="Completed bookings" value={c.completed_bookings} />
        <Kpi label="Lifetime collected" value={ghsShort(c.lifetime_collected_pesewas)} />
        <Kpi label="Cancellations / no-shows" value={`${c.cancellations} / ${c.no_shows}`} />
        <Kpi label="Last visit" value={c.last_visit_at ? fmtDate(c.last_visit_at) : "—"} />
      </div>

      <div className="cols">
        <Card title="Details">
          <dl className="meta">
            <dt>Phone</dt><dd className="mono">{prettyPhone(c.phone_e164)}</dd>
            <dt>WhatsApp username</dt><dd className="mono">{prettyWhatsAppUsername(c.whatsapp_username)}</dd>
            <dt>Preferred contact</dt><dd>{c.pref_contact}</dd>
            <dt>Usual location</dt><dd>{titleise(c.location_type)} · {c.area}<div className="note">{c.address}{c.landmark ? ` · ${c.landmark}` : ""}</div></dd>
            <dt>First touch</dt><dd>{titleise(c.source)}{c.first_campaign ? ` · ${c.first_campaign}` : ""}</dd>
            <dt>Marketing opt-in</dt>
            <dd>{c.marketing_opt_in ? <Chip tone="ok">Opted in {fmtDate(c.consent_at)}</Chip> : <Chip tone="bad">Not opted in</Chip>}</dd>
          </dl>
          {c.notes && <p className="note" style={{ marginTop: 12 }}>{c.notes}</p>}
        </Card>

        <Card title="Bookings" pad={false}>
          {rows.length ? (
            <div className="tablewrap">
              <table>
                <thead><tr><th>Ref</th><th>When</th><th>Service</th><th>Status</th><th className="r">Total</th></tr></thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.id}>
                      <td className="mono"><Link href={`/bookings/${b.id}`}>{b.ref}</Link></td>
                      <td>{fmtDate(b.starts_at)}</td>
                      <td>{b.service_name}</td>
                      <td><BookingChip status={b.status} /></td>
                      <td className="r num">{ghs(b.total_pesewas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty title="No bookings yet" />}
        </Card>

        <Card title="Enquiries" pad={false}>
          {enquiries?.length ? (
            <div className="tablewrap">
              <table>
                <thead><tr><th>Ref</th><th>Received</th><th>Status</th></tr></thead>
                <tbody>
                  {enquiries.map((e) => (
                    <tr key={e.id}>
                      <td className="mono"><Link href={`/enquiries/${e.id}`}>{e.ref}</Link></td>
                      <td>{fmtDateTime(e.created_at)}</td>
                      <td>{titleise(e.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty title="No enquiries on file" />}
        </Card>
      </div>

      {user.role === "owner" && (
        <DangerZone table="client" id={c.id} label="client"
                    from={`/clients/${c.id}`}>
          Erases this person and everything you know about them. If they have
          bookings the database will refuse — delete those first, or leave the
          client in place, which is usually the right call.
        </DangerZone>
      )}
    </>
  );
}
