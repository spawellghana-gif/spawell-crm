"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { findReturningClient, type ReturningClientMatch } from "../actions";

function setValue(id: string, value: string) {
  const element = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  if (!element) return;
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function setCheckbox(id: string, checked: boolean) {
  const element = document.getElementById(id) as HTMLInputElement | null;
  if (!element) return;
  element.checked = checked;
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

export function ReturningClient({ phoneInputId = "phone" }: { phoneInputId?: string }) {
  const [phone, setPhone] = useState("");
  const [match, setMatch] = useState<ReturningClientMatch | null>(null);
  const [checked, setChecked] = useState(false);
  const [lookupState, setLookupState] = useState<"idle" | "checking" | "done" | "error">("idle");

  useEffect(() => {
    const input = document.getElementById(phoneInputId) as HTMLInputElement | null;
    if (!input) return;
    const onInput = () => setPhone(input.value);
    input.addEventListener("input", onInput);
    return () => input.removeEventListener("input", onInput);
  }, [phoneInputId]);

  useEffect(() => {
    setMatch(null);
    setChecked(false);
    if (phone.replace(/\D/g, "").length < 9) {
      setLookupState("idle");
      return;
    }
    setLookupState("checking");
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const result = await findReturningClient(phone);
        if (active) {
          setMatch(result);
          setLookupState("done");
        }
      } catch {
        if (active) setLookupState("error");
      }
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [phone]);

  if (phone.replace(/\D/g, "").length < 9) return null;
  if (lookupState === "checking") return <p className="note" role="status">Checking client records…</p>;
  if (lookupState === "error") return <p className="note" role="alert">Client lookup failed. Check the phone or try again.</p>;
  if (!match) return <p className="note">No existing client found. This will become a new client when booked.</p>;

  const useSavedDetails = () => {
    const sameWhatsApp = !match.whatsapp || match.whatsapp === match.phone;
    setValue("full_name", match.fullName);
    setCheckbox("same_whatsapp", sameWhatsApp);
    setValue("whatsapp", sameWhatsApp ? "" : match.whatsapp);
    setValue("location_type", match.locationType);
    setValue("area", match.area);
    setValue("address", match.address);
    setValue("landmark", match.landmark);
  };
  const lifetime = `GHS ${Math.round(match.lifetimeCollectedPesewas / 100).toLocaleString("en-GH")}`;
  const lastVisit = match.lastVisitAt
    ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(match.lastVisitAt))
    : "No completed visit";

  return (
    <div className="alert ok" role="status" style={{ marginTop: 12, display: "block" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <b>Returning client found: {match.fullName}</b>
          <div style={{ marginTop: 4 }}>
            {match.completedBookings} completed · {lifetime} lifetime · Last visit: {lastVisit}
          </div>
        </div>
        <div className="row">
          <button className="btn" type="button" onClick={useSavedDetails}>Use saved details</button>
          <Link className="btn" href={`/clients/${match.id}`} target="_blank">View history ↗</Link>
        </div>
      </div>
      <label className="row" style={{ marginTop: 10 }}>
        <input
          type="checkbox"
          name="update_client_profile"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
        />
        Save the name, WhatsApp and location entered here as this client’s latest details
      </label>
      <div className="note" style={{ marginTop: 5 }}>Their original lead source and first campaign will remain unchanged.</div>
    </div>
  );
}
