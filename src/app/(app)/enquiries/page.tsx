import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fmtDate, fmtTime, prettyPhone, ghsShort, titleise } from "@/lib/format";
import { Card, Empty, PageHead, EnquiryChip } from "@/components/ui";
import { ENQUIRY_LABEL, type EnquiryView, type EnquiryStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function EnquiriesPage({
  searchParams,
}: { searchParams: { status?: string; q?: string } }) {
  await requireRole("owner", "officer");
  const supabase = supabaseServer();

  let query = supabase.from("enquiry_view").select("*").is("archived_at", null);
  if (searchParams.status) query = query.eq("status", searchParams.status);
  if (searchParams.q) {
    const q = searchParams.q.trim();
    query = query.or(`full_name.ilike.%${q}%,ref.ilike.%${q}%,phone_e164.ilike.%${q}%`);
  }
  const { data, error } = await query.order("created_at", { ascending: false }).limit(200);
  const rows = (data ?? []) as EnquiryView[];
  const now = new Date().toISOString();

  return (
    <>
      <PageHead
        title="Enquiries"
        blurb="WhatsApp-first capture. An enquiry converts straight into a booking — there is no separate deal stage."
        actions={<Link className="btn pri" href="/enquiries/new">+ New enquiry</Link>}
      />

      <form className="row" style={{ marginBottom: 12 }}>
        <input className="inp" name="q" defaultValue={searchParams.q ?? ""}
          placeholder="Name, phone or enquiry ref" style={{ maxWidth: 280 }} />
        <select className="inp" name="status" defaultValue={searchParams.status ?? ""} style={{ maxWidth: 180 }}>
          <option value="">All statuses</option>
          {(Object.keys(ENQUIRY_LABEL) as EnquiryStatus[]).map((k) => (
            <option key={k} value={k}>{ENQUIRY_LABEL[k]}</option>
          ))}
        </select>
        <button className="btn" type="submit">Filter</button>
        <Link className="btn" href="/enquiries">Clear</Link>
      </form>

      {error && <div className="alert bad" style={{ marginBottom: 12 }}><span>⚠</span><span>{error.message}</span></div>}

      <Card pad={false}>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Ref</th><th>Received</th><th>Name</th><th>Phone</th>
                <th>Channel / source</th><th>Service</th><th className="r">Quote</th>
                <th>Status</th><th>Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const late = e.follow_up_at && e.follow_up_at < now &&
                  !["booked", "lost", "spam"].includes(e.status);
                return (
                  <tr key={e.id}>
                    <td className="mono"><Link href={`/enquiries/${e.id}`}>{e.ref}</Link></td>
                    <td>{fmtDate(e.created_at)}<div className="note num">{fmtTime(e.created_at)}</div></td>
                    <td><Link href={`/enquiries/${e.id}`}><b>{e.full_name}</b></Link></td>
                    <td className="mono">{prettyPhone(e.phone_e164)}</td>
                    <td>{titleise(e.channel)}<div className="note">{titleise(e.source)}</div></td>
                    <td>{e.service_name ?? "—"}</td>
                    <td className="r num">{e.quote_pesewas ? ghsShort(e.quote_pesewas) : "—"}</td>
                    <td><EnquiryChip status={e.status} /></td>
                    <td style={late ? { color: "var(--bad)", fontWeight: 600 } : undefined}>
                      {e.follow_up_at ? fmtDate(e.follow_up_at) : "—"}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={9}>
                  <Empty title="No enquiries match">Capture one with the button above.</Empty>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="note" style={{ marginTop: 8 }}>{rows.length} shown.</p>
    </>
  );
}
