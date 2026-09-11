import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { ghsShort, prettyPhone, prettyWhatsAppUsername, fmtDate, titleise } from "@/lib/format";
import { Card, Empty, PageHead, Chip } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ClientsPage({ searchParams }: { searchParams: { q?: string } }) {
  await requireRole("owner", "officer");
  const supabase = supabaseServer();
  let query = supabase.from("client_view").select("*").is("archived_at", null);
  if (searchParams.q) {
    const q = searchParams.q.trim().replace(/^@/, "");
    query = query.or(`full_name.ilike.%${q}%,phone_e164.ilike.%${q}%,whatsapp_username.ilike.%${q}%,area.ilike.%${q}%`);
  }
  const { data } = await query.order("full_name").limit(300);
  const rows = data ?? [];

  return (
    <>
      <PageHead title="Clients" blurb="One record per person, matched by phone number or WhatsApp username so returning clients keep one history." />
      <form className="row" style={{ marginBottom: 12 }}>
        <input className="inp" name="q" defaultValue={searchParams.q ?? ""} placeholder="Name, phone, username or area" style={{ maxWidth: 300 }} />
        <button className="btn" type="submit">Search</button>
        <Link className="btn" href="/clients">Clear</Link>
      </form>
      <Card pad={false}>
        <div className="tablewrap">
          <table>
            <thead><tr>
              <th>Client</th><th>Contact</th><th>Area</th><th>Source</th>
              <th className="r">Completed</th><th className="r">Lifetime</th><th>Last visit</th><th>Opt-in</th>
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/clients/${c.id}`}><b>{c.full_name}</b></Link></td>
                  <td className="mono">
                    {prettyPhone(c.phone_e164)}
                    {c.whatsapp_username && <div className="note mono">{prettyWhatsAppUsername(c.whatsapp_username)}</div>}
                  </td>
                  <td>{c.area}</td>
                  <td>{titleise(c.source)}</td>
                  <td className="r num">{c.completed_bookings}</td>
                  <td className="r num">{ghsShort(c.lifetime_collected_pesewas)}</td>
                  <td>{c.last_visit_at ? fmtDate(c.last_visit_at) : "—"}</td>
                  <td>{c.marketing_opt_in ? <Chip tone="ok">Yes</Chip> : <Chip>No</Chip>}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8}><Empty title="No clients yet">Clients are created when an enquiry converts.</Empty></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
