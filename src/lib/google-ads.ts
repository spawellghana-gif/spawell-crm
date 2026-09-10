/**
 * Google Ads confirmed-booking conversions, via the Data Manager API.
 *
 * This is Google's current architecture for offline conversions and enhanced
 * conversions for leads — POST to datamanager.googleapis.com/v1/events:ingest.
 * It replaces the older Google Ads API ConversionUploadService route, which is
 * why none of that appears here.
 *
 * Nothing in this file runs in the browser and nothing here is imported by a
 * client component. Credentials come from the environment; the module is inert
 * and reports itself unconfigured when they are absent.
 *
 *   GOOGLE_ADS_CUSTOMER_ID          operating account, digits only, no dashes
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID    manager account, if one manages the above
 *   GOOGLE_ADS_CONVERSION_ACTION    the conversion action id from Google Ads
 *   GOOGLE_ADS_QUOTA_PROJECT_ID     Google Cloud project used for API quota
 *   GOOGLE_ADS_SA_CLIENT_EMAIL      service account with Data Manager access
 *   GOOGLE_ADS_SA_PRIVATE_KEY       its private key
 *   GOOGLE_ADS_SYNC_ENABLED         "true" to actually send
 */

import { createHash, createSign } from "node:crypto";

const INGEST_URL = "https://datamanager.googleapis.com/v1/events:ingest";
const SCOPE = "https://www.googleapis.com/auth/datamanager";

const env = (k: string) => (process.env[k] ?? "").trim();

export type GoogleAdsConfig = {
  customerId: string;
  loginCustomerId: string;
  conversionAction: string;
  quotaProjectId: string;
  clientEmail: string;
  privateKey: string;
  syncEnabled: boolean;
};

export function googleAdsConfig(): GoogleAdsConfig {
  return {
    // Google wants the account id without dashes; the id is usually written
    // "627-977-5396" everywhere else, so accept either and normalise here
    // rather than making whoever fills in the variable remember.
    customerId: env("GOOGLE_ADS_CUSTOMER_ID").replace(/-/g, ""),
    loginCustomerId: env("GOOGLE_ADS_LOGIN_CUSTOMER_ID").replace(/-/g, ""),
    conversionAction: env("GOOGLE_ADS_CONVERSION_ACTION"),
    quotaProjectId: env("GOOGLE_ADS_QUOTA_PROJECT_ID"),
    clientEmail: env("GOOGLE_ADS_SA_CLIENT_EMAIL"),
    privateKey: env("GOOGLE_ADS_SA_PRIVATE_KEY").replace(/\\n/g, "\n"),
    syncEnabled: env("GOOGLE_ADS_SYNC_ENABLED").toLowerCase() === "true",
  };
}

/** What is still missing, in the words of the person who has to supply it. */
export function googleAdsMissing(): string[] {
  const c = googleAdsConfig();
  const missing: string[] = [];
  if (!c.customerId) missing.push("GOOGLE_ADS_CUSTOMER_ID");
  if (!c.conversionAction) missing.push("GOOGLE_ADS_CONVERSION_ACTION");
  if (!c.quotaProjectId) missing.push("GOOGLE_ADS_QUOTA_PROJECT_ID");
  if (!c.clientEmail) missing.push("GOOGLE_ADS_SA_CLIENT_EMAIL");
  if (!c.privateKey) missing.push("GOOGLE_ADS_SA_PRIVATE_KEY");
  return missing;
}

export function googleAdsConfigured(): boolean {
  return googleAdsMissing().length === 0;
}

/* ------------------------------------------------------- normalise + hash */

/**
 * Google's normalisation rules, applied before hashing. Getting these wrong
 * does not error — it silently produces a hash that matches nobody, which is
 * indistinguishable from having no customers. Hence the specificity.
 */
export function normaliseEmail(raw: string): string {
  const email = (raw ?? "").trim().toLowerCase().replace(/\s+/g, "");
  const at = email.lastIndexOf("@");
  if (at < 1) return "";
  const domain = email.slice(at + 1);
  let local = email.slice(0, at);

  // Gmail ignores dots and everything after a plus. Other providers do not,
  // so stripping them everywhere would break matching on those domains.
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
    const plus = local.indexOf("+");
    if (plus >= 0) local = local.slice(0, plus);
  }
  return local && domain ? `${local}@${domain}` : "";
}

/**
 * E.164, which is already how this CRM stores phone numbers — see
 * `normalisePhone` in lib/format. This guards the boundary anyway, because a
 * number that arrived some other way must not reach Google half-formatted.
 */
export function normalisePhoneForGoogle(raw: string): string {
  const digits = (raw ?? "").replace(/[^\d+]/g, "");
  if (!digits) return "";
  const e164 = digits.startsWith("+") ? digits : `+${digits}`;
  // A bare local number with no country code cannot be matched and must not be
  // guessed at — sending "+0244010101" would be a fabricated identity.
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : "";
}

export const sha256Hex = (value: string): string =>
  value ? createHash("sha256").update(value, "utf8").digest("hex") : "";

export const hashEmail = (raw: string) => sha256Hex(normaliseEmail(raw));
export const hashPhone = (raw: string) => sha256Hex(normalisePhoneForGoogle(raw));

/* --------------------------------------------------------------- auth */

let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Service-account access token, signed locally.
 *
 * Cached until a minute before expiry: a sync run submits many events and
 * there is no reason to mint a token per event.
 */
async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const c = googleAdsConfig();
  const now = Math.floor(Date.now() / 1000);
  const b64 = (v: string) =>
    Buffer.from(v).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const unsigned =
    `${b64(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.` +
    `${b64(JSON.stringify({
      iss: c.clientEmail,
      scope: SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }))}`;

  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = signer.sign(c.privateKey).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const body = await res.json().catch(() => ({} as any));
  if (!res.ok || !body.access_token) {
    throw new Error(`Google refused the service account: ${body.error_description ?? body.error ?? res.status}`);
  }
  cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

/* ------------------------------------------------------------- ingest */

export type ConversionPayload = {
  /** Both the local idempotency key and Google's transactionId. */
  transactionId: string;
  conversionAt: string;
  valuePesewas: number;
  currency: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  emailSha256?: string;
  phoneSha256?: string;
};

export type IngestResult = {
  ok: boolean;
  httpStatus: number;
  response: unknown;
  error?: string;
};

/**
 * Send one conversion.
 *
 * `validateOnly` asks Google to check the payload without recording it, which
 * is how the integration can be proven end to end before a single real
 * conversion is reported.
 */
export async function sendConversion(
  payload: ConversionPayload,
  opts: { validateOnly?: boolean } = {},
): Promise<IngestResult> {
  const c = googleAdsConfig();
  const missing = googleAdsMissing();
  if (missing.length) {
    return { ok: false, httpStatus: 0, response: null, error: `Configuration required: ${missing.join(", ")}` };
  }

  const identifiers: Record<string, string>[] = [];
  if (payload.emailSha256) identifiers.push({ emailAddress: payload.emailSha256 });
  if (payload.phoneSha256) identifiers.push({ phoneNumber: payload.phoneSha256 });

  const adIdentifiers: Record<string, string> = {};
  if (payload.gclid) adIdentifiers.gclid = payload.gclid;
  if (payload.gbraid) adIdentifiers.gbraid = payload.gbraid;
  if (payload.wbraid) adIdentifiers.wbraid = payload.wbraid;

  // Google needs a click identifier or matchable first-party data. With
  // neither there is nothing to attribute, and sending anyway would be asking
  // Google to invent a link. The caller decides what to do about it.
  if (!Object.keys(adIdentifiers).length && !identifiers.length) {
    return { ok: false, httpStatus: 0, response: null, error: "No ad identifier and no customer match data — nothing to attribute." };
  }

  const body = {
    destinations: [{
      operatingAccount: { accountType: "GOOGLE_ADS", accountId: c.customerId },
      ...(c.loginCustomerId
        ? { loginAccount: { accountType: "GOOGLE_ADS", accountId: c.loginCustomerId } }
        : {}),
      productDestinationId: c.conversionAction,
    }],
    encoding: "HEX",
    events: [{
      eventTimestamp: payload.conversionAt,
      ...(Object.keys(adIdentifiers).length ? { adIdentifiers } : {}),
      conversionValue: payload.valuePesewas / 100,
      currency: payload.currency,
      transactionId: payload.transactionId,
      eventSource: "OTHER",
      ...(identifiers.length ? { userData: { userIdentifiers: identifiers } } : {}),
      // No consent signal is invented from a booking or its contact details.
      consent: { adPersonalization: "CONSENT_STATUS_UNSPECIFIED", adUserData: "CONSENT_STATUS_UNSPECIFIED" },
    }],
    validateOnly: Boolean(opts.validateOnly),
  };

  try {
    const token = await accessToken();
    const res = await fetch(INGEST_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-goog-user-project": c.quotaProjectId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const response = await res.json().catch(() => null);

    if (!res.ok) {
      const message = (response as any)?.error?.message ?? `Google returned ${res.status}`;
      return { ok: false, httpStatus: res.status, response, error: message };
    }

    // A 200 can still carry per-event failures. Treating that as success is
    // how an integration ends up quietly reporting nothing for a month.
    const failures = (response as any)?.errors ?? (response as any)?.eventErrors;
    if (Array.isArray(failures) && failures.length) {
      return { ok: false, httpStatus: res.status, response, error: JSON.stringify(failures).slice(0, 500) };
    }

    if (!opts.validateOnly && !(response as any)?.requestId) {
      return { ok: false, httpStatus: res.status, response, error: "Google returned no upload request ID." };
    }

    return { ok: true, httpStatus: res.status, response };
  } catch (e) {
    return {
      ok: false,
      httpStatus: 0,
      response: null,
      error: e instanceof Error ? e.message : "Request failed",
    };
  }
}

/**
 * Retry schedule: 1m, 5m, 25m, 2h, 10h, then give up at six attempts.
 *
 * Exponential so a Google outage is not hammered, and capped so a permanently
 * malformed event stops consuming the queue and surfaces as failed instead.
 */
export const MAX_ATTEMPTS = 6;

export function nextAttemptAt(attempts: number, from = new Date()): Date | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  const minutes = Math.pow(5, attempts) / 5;
  return new Date(from.getTime() + Math.min(minutes, 600) * 60_000);
}
