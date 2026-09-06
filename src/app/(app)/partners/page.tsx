import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { ghsShort, titleise } from "@/lib/format";
import { Card, Empty, PageHead, Kpi, Chip } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  active: "ok", in_discussion: "info", paused: "warn", ended: "bad",
};

export default async function PartnersPage() {
  await requireRole("owner", "officer");
  const supabase = supabaseServer();
  const { data } = await supabase.from("partner_ledger").select("*").order("name");
  const rows = data ?? [];
  const owed = rows.reduce((t, p) => t + Number(p.owed_pesewas ?? 0), 0);
  const collected = rows.reduce((t, p) => t + Number(p.collected_pesewas ?? 0), 0);

  return (
    <>
      <PageHead
        title="Partners"
        blurb="Hotels, corporates, estate agencies and individual referrers, with commission earned and still owed."
      />
      <div className="kpis" style={{ marginBottom: 14 }}>
        <Kpi label="Active partners" value={rows.filter((p) => p.status === "active").length} />
        <Kpi label="Collected via partners" value={ghsShort(collected)} />
        <Kpi label="Commission owed" value={ghsShort(owed)} detail="earned minus payouts recorded" />
      </div>
      <Card pad={false}>
        <div className="tablewrap">
          <table>
            <thead><tr>
              <th>Partner</th><th>Type</th><th>Status</th><th className="r">Rate</th>
              <th className="r">Enquiries</th><th className="r">Bookings</th>
              <th className="r">Collected</th><th className="r">Owed</th>
            </tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/partners/${p.id}`}><b>{p.name}</b></Link></td>
                  <td><Chip tone={p.type === "hotel" ? "teal" : ""}>{titleise(p.type)}</Chip></td>
                  <td><Chip tone={STATUS_TONE[p.status] ?? ""}>{titleise(p.status)}</Chip></td>
                  <td className="r num">{p.commission_pct ? `${p.commission_pct}%` : "—"}</td>
                  <td className="r num">{p.enquiries}</td>
                  <td className="r num">{p.bookings}</td>
                  <td className="r num">{ghsShort(p.collected_pesewas)}</td>
                  <td className="r num">
                    {Number(p.owed_pesewas) > 0
                      ? <span style={{ color: "var(--bad)", fontWeight: 600 }}>{ghsShort(p.owed_pesewas)}</span>
                      : "—"}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8}><Empty title="No partners yet">Add hotels and referrers in Supabase, or extend this page with a form.</Empty></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
