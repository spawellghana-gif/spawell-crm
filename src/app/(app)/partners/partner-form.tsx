import Link from "next/link";
import { Card, Field } from "@/components/ui";

/** The shape both forms edit. All optional so the add form can pass nothing. */
export type PartnerDraft = {
  id?: string;
  name?: string;
  type?: string;
  status?: string;
  city?: string;
  area?: string;
  address?: string;
  contact_name?: string;
  contact_role?: string;
  phone_e164?: string;
  whatsapp_e164?: string;
  email?: string | null;
  commission_pct?: number | string;
  partner_since?: string | null;
  payment_terms?: string;
  payout_method?: string;
  notes?: string;
};

const TYPES = [
  ["hotel", "Hotel"],
  ["corporate", "Corporate"],
  ["estate_agency", "Estate agency"],
  ["individual_referrer", "Individual referrer"],
  ["agency", "Agency"],
  ["other", "Other"],
];

const STATUSES = [
  ["in_discussion", "In discussion"],
  ["active", "Active"],
  ["paused", "Paused"],
  ["ended", "Ended"],
];

export function PartnerForm({
  action, partner, submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  partner?: PartnerDraft;
  submitLabel: string;
}) {
  const p = partner ?? {};
  const cancelHref = p.id ? `/partners/${p.id}` : "/partners";

  return (
    <form action={action}>
      {p.id && <input type="hidden" name="partner_id" value={p.id} />}
      <Card>
        <div className="fsec">
          <h4>The organisation</h4>
          <div className="fgrid">
            <Field label="Name" name="name">
              <input className="inp" id="name" name="name" required
                     defaultValue={p.name ?? ""} placeholder="Kempinski Gold Coast" />
            </Field>
            <Field label="Type" name="type">
              <select className="inp" id="type" name="type" defaultValue={p.type ?? "hotel"}>
                {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Status" name="status" hint="Only active partners are worth chasing referrals from.">
              <select className="inp" id="status" name="status" defaultValue={p.status ?? "in_discussion"}>
                {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="City" name="city">
              <input className="inp" id="city" name="city" defaultValue={p.city ?? "Accra"} />
            </Field>
            <Field label="Area" name="area">
              <input className="inp" id="area" name="area" defaultValue={p.area ?? ""} placeholder="Ridge" />
            </Field>
            <Field label="Address" name="address">
              <input className="inp" id="address" name="address" defaultValue={p.address ?? ""} />
            </Field>
          </div>
        </div>

        <div className="fsec">
          <h4>Who you deal with</h4>
          <div className="fgrid">
            <Field label="Contact name" name="contact_name">
              <input className="inp" id="contact_name" name="contact_name"
                     defaultValue={p.contact_name ?? ""} placeholder="Yaa Mensah" />
            </Field>
            <Field label="Their role" name="contact_role">
              <input className="inp" id="contact_role" name="contact_role"
                     defaultValue={p.contact_role ?? ""} placeholder="Guest Relations Manager" />
            </Field>
            <Field label="Phone" name="phone" hint="Local or +233 format — stored as +233…">
              <input className="inp" id="phone" name="phone"
                     defaultValue={p.phone_e164 ?? ""} placeholder="030 261 0000" />
            </Field>
            <Field label="WhatsApp" name="whatsapp" hint="Leave blank to use the phone number.">
              <input className="inp" id="whatsapp" name="whatsapp" defaultValue={p.whatsapp_e164 ?? ""} />
            </Field>
            <Field label="Email" name="email">
              <input className="inp" id="email" name="email" type="email" defaultValue={p.email ?? ""} />
            </Field>
          </div>
        </div>

        <div className="fsec">
          <h4>The agreement</h4>
          <div className="fgrid">
            <Field label="Commission %" name="commission_pct"
                   hint="Applied to revenue collected on their referrals.">
              <input className="inp" id="commission_pct" name="commission_pct" type="number"
                     step="0.5" min="0" max="100" defaultValue={p.commission_pct ?? 0} />
            </Field>
            <Field label="Partner since" name="partner_since" hint="Leave blank until the agreement is signed.">
              <input className="inp" id="partner_since" name="partner_since" type="date"
                     defaultValue={p.partner_since ?? ""} />
            </Field>
            <Field label="Payment terms" name="payment_terms">
              <input className="inp" id="payment_terms" name="payment_terms"
                     defaultValue={p.payment_terms ?? ""} placeholder="Settled monthly, last Friday" />
            </Field>
            <Field label="Payout method" name="payout_method">
              <input className="inp" id="payout_method" name="payout_method"
                     defaultValue={p.payout_method ?? ""} placeholder="MTN MoMo / bank transfer" />
            </Field>
          </div>
          <Field label="Notes" name="notes">
            <textarea className="inp" id="notes" name="notes" rows={3}
                      defaultValue={p.notes ?? ""}
                      placeholder="Who introduced them, what they expect, anything that would be lost if you forgot it." />
          </Field>
        </div>

        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <Link className="btn" href={cancelHref}>Cancel</Link>
          <button className="btn pri" type="submit">{submitLabel}</button>
        </div>
      </Card>
    </form>
  );
}
