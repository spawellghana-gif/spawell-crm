import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Field, PageHead, ErrorNote } from "@/components/ui";
import { createEnquiry } from "../actions";
import { ReturningClient } from "./returning-client";

export const dynamic = "force-dynamic";

export default async function NewEnquiryPage({
  searchParams,
}: { searchParams: { error?: string } }) {
  await requireRole("owner", "officer");
  const supabase = supabaseServer();

  const [{ data: services }, { data: partners }, { data: sources }, { data: channels }] =
    await Promise.all([
      supabase.from("service").select("id, name").eq("active", true).order("sort_order"),
      supabase.from("partner").select("id, name, type").is("archived_at", null).order("name"),
      supabase.from("lookup_value").select("value, label").eq("kind", "lead_source").order("sort_order"),
      supabase.from("lookup_value").select("value, label").eq("kind", "channel").order("sort_order"),
    ]);

  return (
    <>
      <PageHead
        title="New enquiry"
        blurb="Capture what the client asked for. Anything you do not know yet can be filled in later."
        actions={<Link className="btn" href="/enquiries">Cancel</Link>}
      />
      <ErrorNote message={searchParams.error} />

      <form action={createEnquiry}>
        <Card>
          <div className="fsec">
            <h4>Contact</h4>
            <div className="fgrid">
              <Field label="Name" name="full_name">
                <input className="inp" id="full_name" name="full_name" required placeholder="Akosua Frimpong" />
              </Field>
              <Field label="Phone" name="phone" hint="Local or +233 format — stored as +233…">
                <input className="inp" id="phone" name="phone" required placeholder="024 401 0101" />
              </Field>
              <Field label="WhatsApp" name="whatsapp">
                <label className="row" style={{ fontSize: 12.5, marginBottom: 4 }}>
                  <input id="same_whatsapp" type="checkbox" name="same_whatsapp" defaultChecked /> Same as phone
                </label>
                <input className="inp" id="whatsapp" name="whatsapp" placeholder="Only if different" />
              </Field>
            </div>
            <ReturningClient />
          </div>

          <div className="fsec">
            <h4>Where it came from</h4>
            <div className="fgrid">
              <Field label="Channel" name="channel">
                <select className="inp" id="channel" name="channel" defaultValue="whatsapp">
                  {(channels ?? []).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="WhatsApp ref" name="ad_ref"
                     hint="If their first message ends with [ref: XXXXXX], paste it — it links the booking to the ad they clicked.">
                <input className="inp mono" id="ad_ref" name="ad_ref" placeholder="K7QP2M" autoComplete="off" />
              </Field>
              <Field label="Lead source" name="source">
                <select className="inp" id="source" name="source" defaultValue="direct_unknown">
                  {(sources ?? []).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="Campaign" name="campaign">
                <input className="inp" id="campaign" name="campaign" placeholder="Accra Home Massage – Search" />
              </Field>
              <Field label="Referring partner" name="partner_id">
                <select className="inp" id="partner_id" name="partner_id" defaultValue="">
                  <option value="">None</option>
                  {(partners ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
            </div>
          </div>

          <div className="fsec">
            <h4>What they want</h4>
            <div className="fgrid">
              <Field label="Service" name="service_id">
                <select className="inp" id="service_id" name="service_id" defaultValue="">
                  <option value="">Not sure yet</option>
                  {(services ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Duration (minutes)" name="duration_min">
                <input className="inp num" id="duration_min" name="duration_min" type="number" defaultValue={60} min={15} step={15} />
              </Field>
              <Field label="Preferred date & time" name="preferred_at">
                <input className="inp" id="preferred_at" name="preferred_at" type="datetime-local" />
              </Field>
              <Field label="Guests" name="guests">
                <input className="inp num" id="guests" name="guests" type="number" defaultValue={1} min={1} max={6} />
              </Field>
              <Field label="Quote (GHS)" name="quote" hint="Leave blank until you have quoted">
                <input className="inp num" id="quote" name="quote" type="number" step="0.01" min="0" />
              </Field>
            </div>
          </div>

          <div className="fsec">
            <h4>Where we are going</h4>
            <div className="fgrid">
              <Field label="Home or hotel" name="location_type">
                <select className="inp" id="location_type" name="location_type" defaultValue="home">
                  <option value="home">Home</option>
                  <option value="hotel">Hotel</option>
                </select>
              </Field>
              <Field label="Area" name="area">
                <input className="inp" id="area" name="area" placeholder="East Legon" />
              </Field>
              <Field label="Full address" name="address">
                <input className="inp" id="address" name="address" />
              </Field>
              <Field label="Landmark" name="landmark">
                <input className="inp" id="landmark" name="landmark" placeholder="Opposite the pharmacy" />
              </Field>
            </div>
            <div style={{ marginTop: 11 }}>
              <Field label="Notes" name="notes" hint="Access notes and preferences. Do not record medical history here.">
                <textarea className="inp" id="notes" name="notes" />
              </Field>
            </div>
          </div>

          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn pri" type="submit">Save enquiry</button>
            <Link className="btn" href="/enquiries">Cancel</Link>
          </div>
        </Card>
      </form>
    </>
  );
}
