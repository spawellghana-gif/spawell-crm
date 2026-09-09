import { requireRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { ghs } from "@/lib/format";
import { Card, Empty, PageHead, Chip } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  await requireRole("owner", "officer");
  const supabase = supabaseServer();

  const [{ data: services }, { data: options }, { data: addons }, { data: zones }] = await Promise.all([
    supabase.from("service").select("*").order("sort_order"),
    supabase.from("service_option").select("*").order("duration_min"),
    supabase.from("service_addon").select("*").order("name"),
    supabase.from("zone").select("*").order("name"),
  ]);

  return (
    <>
      <PageHead title="Services & pricing" blurb="Your catalogue. Prices are all-inclusive — travel is not charged on top." />
      <div className="cols">
        {(services ?? []).map((s) => (
          <Card key={s.id} title={s.name}
            action={s.active ? <Chip tone="ok">Active</Chip> : <Chip>Inactive</Chip>}>
            <table>
              <thead><tr><th>Duration</th><th className="r">Price</th></tr></thead>
              <tbody>
                {(options ?? []).filter((o) => o.service_id === s.id).map((o) => (
                  <tr key={o.id}><td>{o.duration_min} minutes</td><td className="r num">{ghs(o.price_pesewas)}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: 10 }}>
              {(addons ?? []).filter((a) => a.service_id === s.id).map((a) => (
                <Chip key={a.id} tone="sand">{a.name} · {ghs(a.price_pesewas)}</Chip>
              ))}
            </div>
            <p className="note" style={{ marginTop: 8 }}>Prep and cleanup buffer {s.buffer_min} minutes.</p>
          </Card>
        ))}
        {!services?.length && <Empty title="No services yet">Run supabase/seed.sql.</Empty>}
      </div>

      <div style={{ height: 12 }} />
      <Card title="Areas we cover">
        <p className="note" style={{ marginTop: 0 }}>
          Where therapists travel to. Kept for dispatch and travel planning —
          not a price list, because travel is included in the service price.
        </p>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {(zones ?? []).map((z) => <Chip key={z.id}>{z.name}</Chip>)}
          {!zones?.length && <span className="note">No areas defined yet.</span>}
        </div>
      </Card>
    </>
  );
}
