import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Card, Field, PageHead, ErrorNote } from "@/components/ui";
import { createTherapist } from "../actions";

export const dynamic = "force-dynamic";

const DAYS = [
  { v: 0, label: "Sun" }, { v: 1, label: "Mon" }, { v: 2, label: "Tue" },
  { v: 3, label: "Wed" }, { v: 4, label: "Thu" }, { v: 5, label: "Fri" },
  { v: 6, label: "Sat" },
];

export default async function NewTherapistPage({
  searchParams,
}: { searchParams: { error?: string } }) {
  await requireRole("owner");

  return (
    <>
      <PageHead
        title="Add therapist"
        blurb="Working days and hours feed the availability check, so a booking cannot be assigned to someone who is off."
        actions={<Link className="btn" href="/therapists">Cancel</Link>}
      />
      <ErrorNote message={searchParams.error} />

      <form action={createTherapist}>
        <Card>
          <div className="fsec">
            <h4>Who they are</h4>
            <div className="fgrid">
              <Field label="Full name" name="full_name">
                <input className="inp" id="full_name" name="full_name" required placeholder="Ama Boateng" />
              </Field>
              <Field label="Phone" name="phone" hint="Local or +233 format — stored as +233…">
                <input className="inp" id="phone" name="phone" required placeholder="024 401 0101" />
              </Field>
              <Field label="Gender" name="gender" hint="Some clients request a female or male therapist.">
                <select className="inp" id="gender" name="gender" defaultValue="female">
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                </select>
              </Field>
              <Field label="City" name="city">
                <input className="inp" id="city" name="city" defaultValue="Accra" />
              </Field>
              <Field label="Base area" name="base_area" hint="Where they travel from — used to judge transport.">
                <input className="inp" id="base_area" name="base_area" required placeholder="East Legon" />
              </Field>
              <Field label="Rating" name="rating" hint="Optional. 0–5, one decimal.">
                <input className="inp" id="rating" name="rating" type="number" step="0.1" min="0" max="5" placeholder="4.8" />
              </Field>
            </div>
          </div>

          <div className="fsec">
            <h4>When they work</h4>
            <Field label="Working days" name="work_days" hint="Leave all ticked for a six-day week.">
              <div className="row" style={{ gap: 14, flexWrap: "wrap", paddingTop: 2 }}>
                {DAYS.map((d) => (
                  <label key={d.v} className="row" style={{ gap: 5, fontSize: 12.5 }}>
                    <input type="checkbox" name="work_days" value={d.v} defaultChecked={d.v !== 0} />
                    {d.label}
                  </label>
                ))}
              </div>
            </Field>
            <div className="fgrid" style={{ marginTop: 10 }}>
              <Field label="Starts" name="work_start">
                <input className="inp" id="work_start" name="work_start" type="time" defaultValue="09:00" required />
              </Field>
              <Field label="Finishes" name="work_end">
                <input className="inp" id="work_end" name="work_end" type="time" defaultValue="20:00" required />
              </Field>
              <Field label="Maximum bookings a day" name="max_daily" hint="The availability check refuses assignments past this.">
                <input className="inp" id="max_daily" name="max_daily" type="number" min="1" defaultValue="4" required />
              </Field>
            </div>
            <label className="row" style={{ gap: 6, fontSize: 12.5, marginTop: 10 }}>
              <input type="checkbox" name="active" defaultChecked /> Available for new bookings
            </label>
          </div>

          <div className="fsec">
            <h4>Pay</h4>
            <p className="note" style={{ marginTop: -4, marginBottom: 10 }}>
              Stored in a separate table only you can read. Booking officers and
              therapists get no rows back from it at all.
            </p>
            <div className="fgrid">
              <Field label="Commission %" name="commission_pct" hint="Share of the booking total.">
                <input className="inp" id="commission_pct" name="commission_pct" type="number" step="0.5" min="0" max="100" defaultValue="0" />
              </Field>
              <Field label="Hourly rate (GHS)" name="hourly" hint="Optional — leave at 0 if commission-only.">
                <input className="inp" id="hourly" name="hourly" placeholder="0.00" />
              </Field>
              <Field label="Pay notes" name="pay_notes">
                <input className="inp" id="pay_notes" name="pay_notes" placeholder="Paid weekly on Fridays" />
              </Field>
            </div>
          </div>

          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <Link className="btn" href="/therapists">Cancel</Link>
            <button className="btn pri" type="submit">Add therapist</button>
          </div>
        </Card>
      </form>

      <p className="note" style={{ marginTop: 10 }}>
        This creates the roster record. If this person should also sign in to
        see their own jobs, create their user in Supabase (Authentication →
        Users), then set this therapist row&rsquo;s <code>user_id</code> to that
        new user&rsquo;s id. Without that link the app cannot tell which
        appointments are theirs, and they will correctly see nothing.
      </p>
    </>
  );
}
