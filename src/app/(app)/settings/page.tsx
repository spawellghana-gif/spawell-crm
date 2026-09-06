import { requireRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { fmtDateTime, titleise } from "@/lib/format";
import { Card, Empty, PageHead, Field, Chip } from "@/components/ui";

export const dynamic = "force-dynamic";

async function updateRole(formData: FormData) {
  "use server";
  await requireRole("owner");
  const supabase = supabaseServer();
  await supabase.from("app_user")
    .update({ role: String(formData.get("role")) })
    .eq("id", String(formData.get("user_id")));
  revalidatePath("/settings");
}

async function updateSettings(formData: FormData) {
  "use server";
  await requireRole("owner");
  const supabase = supabaseServer();
  await supabase.from("settings").update({
    business_name: String(formData.get("business_name") ?? ""),
    whatsapp_e164: String(formData.get("whatsapp_e164") ?? ""),
    retention_note: String(formData.get("retention_note") ?? ""),
    privacy_note: String(formData.get("privacy_note") ?? ""),
    updated_at: new Date().toISOString(),
  }).eq("id", true);
  revalidatePath("/settings");
}

export default async function SettingsPage() {
  await requireRole("owner");
  const supabase = supabaseServer();

  const [{ data: settings }, { data: users }, { data: audit }] = await Promise.all([
    supabase.from("settings").select("*").eq("id", true).maybeSingle(),
    supabase.from("app_user").select("*").order("full_name"),
    supabase.from("audit_log").select("*").order("at", { ascending: false }).limit(40),
  ]);

  return (
    <>
      <PageHead title="Settings" blurb="Owner only. Roles here are enforced by the database, not by hiding menu items." />
      <div className="cols">
        <Card title="Business">
          <form action={updateSettings} className="stack" style={{ gap: 11 }}>
            <Field label="Business name" name="business_name">
              <input className="inp" id="business_name" name="business_name" defaultValue={settings?.business_name ?? ""} />
            </Field>
            <Field label="Business WhatsApp" name="whatsapp_e164">
              <input className="inp" id="whatsapp_e164" name="whatsapp_e164" defaultValue={settings?.whatsapp_e164 ?? ""} />
            </Field>
            <Field label="Data retention" name="retention_note">
              <textarea className="inp" id="retention_note" name="retention_note" defaultValue={settings?.retention_note ?? ""} />
            </Field>
            <Field label="Privacy notice" name="privacy_note">
              <textarea className="inp" id="privacy_note" name="privacy_note" defaultValue={settings?.privacy_note ?? ""} />
            </Field>
            <div><button className="btn pri" type="submit">Save</button></div>
          </form>
        </Card>

        <Card title="Users & roles" pad={false}>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Name</th><th>Role</th><th>Active</th><th></th></tr></thead>
              <tbody>
                {(users ?? []).map((u) => (
                  <tr key={u.id}>
                    <td><b>{u.full_name}</b></td>
                    <td>
                      <form action={updateRole} className="row">
                        <input type="hidden" name="user_id" value={u.id} />
                        <select className="inp" name="role" defaultValue={u.role} style={{ maxWidth: 160 }}>
                          <option value="owner">Owner/Admin</option>
                          <option value="officer">Booking Officer</option>
                          <option value="therapist">Therapist</option>
                        </select>
                        <button className="btn sm" type="submit">Save</button>
                      </form>
                    </td>
                    <td>{u.active ? <Chip tone="ok">Active</Chip> : <Chip tone="bad">Disabled</Chip>}</td>
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note" style={{ padding: "8px 14px" }}>
            Add people in Supabase → Authentication → Users. The first to sign up
            becomes the owner; everyone after starts as a booking officer.
            A therapist also needs their <code>therapist.user_id</code> set so
            the app knows which appointments are theirs.
          </p>
        </Card>

        <Card title="Audit log" pad={false}>
          <div className="tablewrap">
            {audit?.length ? (
              <table>
                <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th></tr></thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id}>
                      <td>{fmtDateTime(a.at)}</td>
                      <td>{a.actor_name ?? "System"}<div className="note">{a.actor_role ?? ""}</div></td>
                      <td>{titleise(a.action)}</td>
                      <td className="mono">{a.record_type} {a.record_id ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty title="Nothing logged yet" />}
          </div>
          <p className="note" style={{ padding: "8px 14px" }}>
            Append-only: written by database triggers, and there is no update or
            delete policy on it — not even for you.
          </p>
        </Card>
      </div>
    </>
  );
}
