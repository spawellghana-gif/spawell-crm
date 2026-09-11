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

export function ReturningClient({
  phoneInputId = "phone",
  usernameInputId = "whatsapp_username",
}: {
  phoneInputId?: string;
  usernameInputId?: string;
}) {
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [match, setMatch] = useState<ReturningClientMatch | null>(null);
  const [checked, setChecked] = useState(false);
  const [lookupState, setLookupState] = useState<"idle" | "checking" | "done" | "error">("idle");

  useEffect(() => {
    const phoneInput = document.getElementById(phoneInputId) as HTMLInputElement | null;
    const usernameInput = document.getElementById(usernameInputId) as HTMLInputElement | null;
    const onPhone = () => setPhone(phoneInput?.value ?? "");
    const onUsername = () => setUsername(usernameInput?.value ?? "");
    phoneInput?.addEventListener("input", onPhone);
    usernameInput?.addEventListener("input", onUsername);
    return () => {
      phoneInput?.removeEventListener("input", onPhone);
      usernameInput?.removeEventListener("input", onUsername);
    };
  }, [phoneInputId, usernameInputId]);

  const hasPhone = phone.replace(/\D/g, "").length >= 9;
  const hasUsername = username.trim().replace(/^@+/, "").length > 0;

  useEffect(() => {
    setMatch(null);
    setChecked(false);
    if (!hasPhone && !hasUsername) {
      setLookupState("idle");
      return;
    }
    setLookupState("checking");
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const result = await findReturningClient(hasPhone ? phone : "", username);
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
  }, [phone, username, hasPhone, hasUsername]);

  if (!hasPhone && !hasUsername) return null;
  if (lookupState === "checking") return <p className="note" role="status">Checking client records…</p>;
  if (lookupState === "error") return <p className="note" role="alert">Client lookup failed. Check the phone or WhatsApp username and try again.</p>;
  if (!match) return <p className="note">No existing client found. This will become a new client when booked.</p>;

  const useSavedDetails = () => {
    const sameWhatsApp = Boolean(match.phone) && (!match.whatsapp || match.whatsapp === match.phone);
    setValue("full_name", match.fullName);
    setValue("phone", match.phone);
    setValue("whatsapp_username", match.whatsappUsername ? `@${match.whatsappUsername}` : "");
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
          {match.whatsappUsername && <div className="note" style={{ marginTop: 3 }}>WhatsApp @{match.whatsappUsername}</div>}
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
        Save the name, contact details and location entered here as this client’s latest details
      </label>
      <div className="note" style={{ marginTop: 5 }}>Their original lead source and first campaign will remain unchanged.</div>
    </div>
  );
}
