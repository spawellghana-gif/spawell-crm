/** Ghana-specific formatting. Money is pesewas everywhere in the database. */

export const TZ = process.env.APP_TIMEZONE ?? "Africa/Accra";

/** 45000 -> "GHS 450.00" */
export function ghs(pesewas: number | null | undefined): string {
  const v = (pesewas ?? 0) / 100;
  return (
    "GHS " +
    v.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

/** 45000 -> "GHS 450" — for dense tables and KPI tiles. */
export function ghsShort(pesewas: number | null | undefined): string {
  return "GHS " + Math.round((pesewas ?? 0) / 100).toLocaleString("en-GH");
}

/** "450.00" or "450" typed by a person -> 45000 pesewas. */
export function toPesewas(input: string | number): number {
  const n = typeof input === "number" ? input : parseFloat(String(input).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, day: "2-digit", month: "short", year: "numeric",
});
const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true,
});
const dowFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short" });

/** "04 Sep 2026" */
export const fmtDate = (iso: string | null | undefined) =>
  iso ? dateFmt.format(new Date(iso)) : "—";
/** "4:30 pm" */
export const fmtTime = (iso: string | null | undefined) =>
  iso ? timeFmt.format(new Date(iso)).toUpperCase() : "";
/** "Fri 04 Sep 2026 · 4:30 PM" */
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? `${dowFmt.format(new Date(iso))} ${dateFmt.format(new Date(iso))} · ${fmtTime(iso)}` : "—";

/** Today in Accra, as YYYY-MM-DD — the day the business is having. */
export function todayAccra(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}
export function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Ghana numbers into E.164. "024 401 0101" and "+233 24 401 0101" and
 * "244010101" all land on "+233244010101" so duplicate detection works and
 * wa.me links are valid. An unknown number stays blank rather than becoming
 * "+", because WhatsApp can now identify a client by username alone.
 */
export function normalisePhone(raw: string | null | undefined): string {
  let d = (raw ?? "").replace(/[^\d+]/g, "");
  if (!d) return "";
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("00")) d = d.slice(2);
  if (!d) return "";
  if (d.startsWith("0")) d = "233" + d.slice(1);
  if (!d.startsWith("233") && d.length === 9) d = "233" + d;
  return "+" + d;
}

export function prettyPhone(raw: string | null | undefined): string {
  const normalised = normalisePhone(raw);
  if (!normalised) return "—";
  const d = normalised.replace("+", "");
  return d.startsWith("233")
    ? `+233 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`
    : "+" + d;
}

/** Store WhatsApp usernames without the display @ and compare case-insensitively. */
export function normaliseWhatsAppUsername(raw: string | null | undefined): string {
  return (raw ?? "").trim().replace(/^@+/, "").toLowerCase();
}

export function prettyWhatsAppUsername(raw: string | null | undefined): string {
  const username = normaliseWhatsAppUsername(raw);
  return username ? `@${username}` : "—";
}

export function waLink(phone: string, message: string): string {
  return `https://wa.me/${normalisePhone(phone).replace("+", "")}?text=${encodeURIComponent(message)}`;
}

/** Fill {name} {service} {amount} … in a message template. */
export function fillTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}

export const titleise = (s: string) =>
  s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
