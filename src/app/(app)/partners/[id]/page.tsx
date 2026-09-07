import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole, requireUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { ghs, ghsShort, prettyPhone, fmtDate, fmtDateTime, waLink, titleise } from "@/lib/format";
import { Card, Empty, PageHead, Kpi, Chip, ErrorNote, BookingChip } from "@/components/ui";
import type { BookingView } from "@/lib/types";
import { recordPartnerPayout, logPartnerEvent, archivePartner } from "../actions";
import { DangerZone } from "@/components/danger-zone";

export const dynamic = "force-dynamic";

export default async function PartnerDetail({
  params, searchParams,
}: { params: { id: string }; searchParams: { error?: string } }) {
  await requireRole("owner", "officer");
  const user = await requireUser();
  const supabase = supabaseServer();

  const [{ data: partner }, { data: ledgerRows }] = await Promise.all([
    supabase.from("partner").select("*").eq("id", params.id).maybeSingle(),
    supabase.from("partner_ledger").select("*").eq("id", params.id),
  ]);
  if (!partner) notFound();
  const ledger = ledgerRows?.[0];

  const [{ data: bookings }, { data: events }, { data: payouts }, { data: methods }] = await Promise.all([
    supabase.from("booking_view").select("*").eq("partner_id", partner.id).order("starts_at", { ascending: false }).limit(50),
    supabase.from("partner_event").select("*").eq("partner_id", partner.id).order("created_at", { ascending: false }),
    supabase.from("expense").select("*").eq("partner_id", partner.id).eq("category", "partner_commission").order("spent_on", { ascending: false }),
    supabase.from("lookup_value").select("value, label").eq("kind", "payment_method").order("sort_order"),
  ]);
  const rows = (bookings ?? []) as BookingView[];
  const owed = Number(ledger?.owed_pesewas ?? 0);

  return (
    <>
      <PageHead
        title={partner.name}
        blurb={`${titleise(partner.type)} · ${partner.area}`}
        actions={
          <>
            {partner.phone_e164 && (
              <a className="btn pri" target="_blank" rel="noopener noreferrer"
                 href={waLink(partner.whatsapp_e164 || partner.phone_e164, `Hello ${partner.contact_name.split(" ")[0]}, this is SpaWellGhana. `)}>
                Open in WhatsApp ↗
              </a>
            )}
            <Link className="btn" href={`/partners/${partner.id}/edit`}>Edit</Link>
            <Link className="btn" href="/partners">Back</Link>
          </>
        }
      />
      <ErrorNote message={searchParams.error} />

      <div className="kpis" style={{ marginBottom: 14 }}>
        <Kpi label="Enquiries referred" value={ledger?.enquiries ?? 0} />
        <Kpi label="Bookings" value={ledger?.bookings ?? 0} />
        <Kpi label="Collected revenue" value={ghsShort(ledger?.collected_pesewas ?? 0)} />
        <Kpi label="Commission earned" value={ghsShort(ledger?.commission_earned_pesewas ?? 0)}
             detail={`${partner.commission_pct}% of collected`} />
        <Kpi label="Owed now" value={owed > 0 ? ghsShort(owed) : "Settled"} />
      </div>

      <div className="cols">
        <Card title="Agreement">
          <dl className="meta">
            <dt>Contact</dt>
            <dd>{partner.contact_name}{partner.contact_role ? ` · ${partner.contact_role}` : ""}
              <div className="note mono">{partner.phone_e164 ? prettyPhone(partner.phone_e164) : ""}{partner.email ? ` · ${partner.email}` : ""}</div></dd>
            <dt>Status</dt><dd><Chip tone={partner.status === "active" ? "ok" : "warn"}>{titleise(partner.status)}</Chip></dd>
            <dt>Partner since</dt><dd>{partner.partner_since ? fmtDate(partner.partner_since) : "Not yet agreed"}</dd>
            <dt>Commission</dt><dd className="num">{partner.commission_pct}% of collected revenue</dd>
            <dt>Terms</dt><dd>{partner.payment_terms || "—"}<div className="note">Paid by {titleise(partner.payout_method || "—")}</div></dd>
          </dl>
          {partner.notes && <p className="note" style={{ marginTop: 12 }}>{partner.notes}</p>}
        </Card>

        {user.role === "owner" && (
          <Card title="Commission payouts">
            <form action={recordPartnerPayout} className="row">
              <input type="hidden" name="partner_id" value={partner.id} />
              <input className="inp num" name="amount" type="number" step="0.01" min="0"
                placeholder="Amount GHS" style={{ maxWidth: 140 }}
                defaultValue={owed > 0 ? (owed / 100).toFixed(2) : ""} required />
              <select className="inp" name="method" style={{ maxWidth: 150 }} defaultValue="bank_transfer">
                {(methods ?? []).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <input className="inp" name="provider_ref" placeholder="Reference" style={{ maxWidth: 140 }} />
              <button className="btn pri" type="submit">Record payout</button>
            </form>
            <div className="tablewrap" style={{ marginTop: 12 }}>
              {payouts?.length ? (
                <table>
                  <thead><tr><th>Reference</th><th>Date</th><th>Method</th><th className="r">Amount</th></tr></thead>
                  <tbody>
                    {payouts.map((p) => (
                      <tr key={p.id}>
                        <td className="mono">{p.provider_ref || "—"}</td>
                        <td>{fmtDate(p.spent_on)}</td>
                        <td>{titleise(p.method)}</td>
                        <td className="r num">{ghs(p.amount_pesewas)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <Empty title="No payouts recorded">Settling here posts a partner commission expense in Finance.</Empty>}
            </div>
          </Card>
        )}

        <Card title="Referred bookings" pad={false}>
          {rows.length ? (
            <div className="tablewrap">
              <table>
                <thead><tr><th>Ref</th><th>When</th><th>Client</th><th>Status</th><th className="r">Total</th></tr></thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.id}>
                      <td className="mono"><Link href={`/bookings/${b.id}`}>{b.ref}</Link></td>
                      <td>{fmtDate(b.starts_at)}</td>
                      <td>{b.client_name}</td>
                      <td><BookingChip status={b.status} /></td>
                      <td className="r num">{ghs(b.total_pesewas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty title="No bookings yet">Set this partner on an enquiry to attribute it here.</Empty>}
        </Card>

        <Card title="Relationship">
          <form action={logPartnerEvent} className="row" style={{ marginBottom: 12 }}>
            <input type="hidden" name="partner_id" value={partner.id} />
            <select className="inp" name="type" style={{ maxWidth: 130 }} defaultValue="call">
              <option value="call">Call</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="meeting">Meeting</option>
              <option value="note">Note</option>
            </select>
            <input className="inp" name="body" placeholder="Dropped cards at the concierge desk"
              style={{ flex: 1, minWidth: 160 }} required />
            <button className="btn pri" type="submit">Log</button>
          </form>
          {events?.length ? (
            <ul className="tl">
              {events.map((ev) => (
                <li key={ev.id}><time>{fmtDateTime(ev.created_at)} · {titleise(ev.type)}</time>{ev.body}</li>
              ))}
            </ul>
          ) : <Empty title="Nothing logged yet" />}
        </Card>
      </div>

      {user.role === "owner" && (
        <div style={{ marginTop: 14 }}>
        <Card title="End this partnership">
          <p className="note" style={{ marginTop: 0 }}>
            Archiving hides {partner.name} from the partner list and marks the
            agreement ended. Their past bookings, commission and payouts stay
            exactly as they are &mdash; deleting the record would rewrite what
            previous months earned.
            {owed > 0 && (
              <> There is still <b>{ghs(owed)}</b> owed; settle it above first.</>
            )}
          </p>
          <form action={archivePartner}>
            <input type="hidden" name="partner_id" value={partner.id} />
            <button className="btn" type="submit">Archive partner</button>
          </form>
        </Card>
        </div>
      )}

      {user.role === "owner" && (
        <DangerZone table="partner" id={partner.id} label="partner"
                    from={`/partners/${partner.id}`}
                    warning={"Archiving above does what you usually want. Delete only a partner added by mistake."}>
          Erases {partner.name} and the whole relationship log. Their referred
          bookings and any commission you already paid stay, but detach from
          them &mdash; so this partner disappears from your commission figures
          entirely, past months included.
        </DangerZone>
      )}
    </>
  );
}
