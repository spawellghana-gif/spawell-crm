/**
 * Advertising attribution, and the WhatsApp gap.
 *
 * THE PROBLEM
 * A visitor clicks a Google ad, lands on spawellghana.com, taps the WhatsApp
 * button and is gone. WhatsApp carries no cookie, no referrer and no gclid.
 * By the time a booking officer types the enquiry into this CRM, every
 * technical link to the ad click has been severed.
 *
 * THE MECHANISM
 * The website posts the click identifiers to /api/attribution and gets back a
 * short opaque token. That token — and only that token — is placed in the
 * prefilled WhatsApp message the customer sends:
 *
 *     "Hi SpaWellGhana, I'd like to book a massage. [ref: K7QP2M]"
 *
 * The officer sees the ref in the very first message, and the enquiry form
 * accepts it. Claiming the token binds the click to the enquiry.
 *
 * WHY A TOKEN AND NOT THE GCLID
 * A gclid in a public wa.me URL is an advertising identifier sitting in a link
 * that gets forwarded, screenshotted and indexed. The token grants nothing but
 * the ability to claim one anonymous click row, and carries no personal data
 * at all — which is what the brief requires.
 *
 * THE HONEST LIMITATION
 * This is deterministic only when the customer actually sends the prefilled
 * text. Some will clear it and type their own message. For those, the
 * fallback below is a time-boxed, single-candidate heuristic that will not
 * guess: if two clicks are plausible, it attributes neither. An enquiry with
 * no ref and no unambiguous candidate stays unattributed, which is correct.
 * Attribution that is invented is worse than attribution that is missing,
 * because it silently teaches Google to buy the wrong traffic.
 */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1

/** Six characters, ~1 in a billion collision at this volume, easy to read aloud. */
export function mintToken(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return out;
}

/** Pull "[ref: K7QP2M]", "ref K7QP2M" or a bare token out of a pasted message. */
export function extractToken(text: string): string {
  if (!text) return "";
  const tagged = text.match(/ref\s*[:\-]?\s*([A-HJ-NP-Z2-9]{6})/i);
  if (tagged) return tagged[1].toUpperCase();
  const bare = text.trim().match(/^([A-HJ-NP-Z2-9]{6})$/i);
  return bare ? bare[1].toUpperCase() : "";
}

export type ClickInput = {
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  landing_page?: string;
  referrer?: string;
};

/** Keep it to what was actually sent, trimmed and length-capped. */
export function sanitiseClick(input: ClickInput) {
  const s = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max);
  return {
    gclid: s(input.gclid, 200),
    gbraid: s(input.gbraid, 200),
    wbraid: s(input.wbraid, 200),
    utm_source: s(input.utm_source, 100),
    utm_medium: s(input.utm_medium, 100),
    utm_campaign: s(input.utm_campaign, 200),
    utm_term: s(input.utm_term, 200),
    utm_content: s(input.utm_content, 200),
    landing_page: s(input.landing_page, 500),
    referrer: s(input.referrer, 500),
  };
}

export type ClickRow = ReturnType<typeof sanitiseClick>;

/**
 * Is there real evidence this came from Google Ads?
 *
 * A click identifier is proof. `utm_source=google` with `utm_medium=cpc` is
 * strong enough to treat as Google Ads. Organic Google traffic is not, and
 * neither is an empty record — those return 'none' and no conversion is ever
 * created for them.
 */
export function attributionStatus(click: Partial<ClickRow>): "google_ads" | "other" | "none" {
  if (click.gclid || click.gbraid || click.wbraid) return "google_ads";
  const source = (click.utm_source ?? "").toLowerCase();
  const medium = (click.utm_medium ?? "").toLowerCase();
  if (source === "google" && ["cpc", "ppc", "paid", "paidsearch"].includes(medium)) return "google_ads";
  if (source || medium) return "other";
  return "none";
}

/**
 * Which CRM lead source a click corresponds to, so the existing Marketing page
 * and the new one agree rather than reporting two different truths.
 */
export function crmSource(click: Partial<ClickRow>): string {
  const status = attributionStatus(click);
  if (status === "google_ads") return "google_search_ads";
  const source = (click.utm_source ?? "").toLowerCase();
  const medium = (click.utm_medium ?? "").toLowerCase();
  if (source.includes("instagram")) return medium.includes("paid") || medium === "cpc" ? "instagram_ads" : "instagram_organic";
  if (source.includes("facebook")) return "facebook";
  if (source.includes("tiktok")) return "tiktok";
  if (source === "google") return "google_organic";
  return "direct_unknown";
}

/**
 * The fallback, used only when no ref token was supplied.
 *
 * Deliberately strict: exactly one unclaimed Google click inside the window,
 * or nothing. Returning "the most recent" would attribute every WhatsApp
 * enquiry to whichever ad happened to be clicked last by anyone, which is not
 * attribution — it is noise wearing attribution's clothes.
 */
export function pickUnambiguousClick<T extends { id: string; first_touch_at: string }>(
  candidates: T[],
  enquiryAt: Date,
  windowMinutes = 60,
): { click: T | null; reason: string } {
  const lower = enquiryAt.getTime() - windowMinutes * 60_000;
  const inWindow = candidates.filter((c) => {
    const t = new Date(c.first_touch_at).getTime();
    return t <= enquiryAt.getTime() && t >= lower;
  });
  if (inWindow.length === 1) return { click: inWindow[0], reason: "single unclaimed click in window" };
  if (inWindow.length === 0) return { click: null, reason: "no unclaimed click in window" };
  return { click: null, reason: `${inWindow.length} candidate clicks — ambiguous, not attributed` };
}
