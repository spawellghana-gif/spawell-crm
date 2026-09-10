/**
 * Google Ads confirmed-booking conversions, via the Data Manager API.
 *
 * Production authentication is keyless:
 * Vercel OIDC -> Google Security Token Service -> service-account
 * impersonation -> Data Manager API. A legacy JSON service-account key may be
 * used only as a fallback for non-Vercel environments.
 */

import { createHash, createSign } from "node:crypto";

const INGEST_URL = "https://datamanager.googleapis.com/v1/events:ingest";
const SCOPE = "https://www.googleapis.com/auth/datamanager";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/**
 * Non-secret Google/Vercel federation identifiers for this CRM deployment.
 * The Google provider itself additionally enforces the production-only `sub`
 * condition, so a token from another Vercel project/environment is rejected.
 */
export const GOOGLE_ADS_WIF = {
  projectId: "rising-capsule-508207-c9",
  projectNumber: "886115180549",
  poolId: "vercel",
  providerId: "vercel-prod",
  serviceAccountEmail: "spawell-service-manager@rising-capsule-508207-c9.iam.gserviceaccount.com",
  expectedVercelAudience: "https://vercel.com/spawellghana-7029s-projects",
} as const;

const env = (k: string) => (process.env[k] ?? "").trim();

export type GoogleAdsAuthMode = "vercel_oidc" | "service_account_key" | "none";

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
    customerId: env("GOOGLE_ADS_CUSTOMER_ID").replace(/-/g, ""),
    loginCustomerId: env("GOOGLE_ADS_LOGIN_CUSTOMER_ID").replace(/-/g, ""),
    conversionAction: env("GOOGLE_ADS_CONVERSION_ACTION"),
    quotaProjectId: env("GOOGLE_ADS_QUOTA_PROJECT_ID") || GOOGLE_ADS_WIF.projectId,
    clientEmail: env("GOOGLE_ADS_SA_CLIENT_EMAIL"),
    privateKey: env("GOOGLE_ADS_SA_PRIVATE_KEY").replace(/\\n/g, "\n"),
    syncEnabled: env("GOOGLE_ADS_SYNC_ENABLED").toLowerCase() === "true",
  };
}

export function googleAdsAuthMode(): GoogleAdsAuthMode {
  if (env("VERCEL_OIDC_TOKEN")) return "vercel_oidc";
  const c = googleAdsConfig();
  if (c.clientEmail && c.privateKey) return "service_account_key";
  return "none";
}

/** What is still missing, in the words of the person who has to supply it. */
export function googleAdsMissing(): string[] {
  const c = googleAdsConfig();
  const missing: string[] = [];
  if (!c.customerId) missing.push("GOOGLE_ADS_CUSTOMER_ID");
  if (!c.conversionAction) missing.push("GOOGLE_ADS_CONVERSION_ACTION");
  if (!c.quotaProjectId) missing.push("GOOGLE_ADS_QUOTA_PROJECT_ID");
  if (googleAdsAuthMode() === "none") missing.push("Vercel OIDC or service-account credential");
  return missing;
}

export function googleAdsConfigured(): boolean {
  return googleAdsMissing().length === 0;
}

/* ------------------------------------------------------- normalise + hash */

export function normaliseEmail(raw: string): string {
  const email = (raw ?? "").trim().toLowerCase().replace(/\s+/g, "");
  const at = email.lastIndexOf("@");
  if (at < 1) return "";
  const domain = email.slice(at + 1);
  let local = email.slice(0, at);

  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
    const plus = local.indexOf("+");
    if (plus >= 0) local = local.slice(0, plus);
  }
  return local && domain ? `${local}@${domain}` : "";
}

export function normalisePhoneForGoogle(raw: string): string {
  const digits = (raw ?? "").replace(/[^\d+]/g, "");
  if (!digits) return "";
  const e164 = digits.startsWith("+") ? digits : `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : "";
}

export const sha256Hex = (value: string): string =>
  value ? createHash("sha256").update(value, "utf8").digest("hex") : "";

export const hashEmail = (raw: string) => sha256Hex(normaliseEmail(raw));
export const hashPhone = (raw: string) => sha256Hex(normalisePhoneForGoogle(raw));

/* --------------------------------------------------------------- auth */

let cachedToken: { value: string; expiresAt: number } | null = null;

function googleError(body: any, fallback: string): string {
  return body?.error?.message ?? body?.error_description ?? body?.error ?? fallback;
}

/**
 * Exchange Vercel's short-lived OIDC token for a Google federated token, then
 * impersonate the dedicated service account to obtain the Data Manager scope.
 */
async function oidcAccessToken(subjectToken: string): Promise<{ value: string; expiresAt: number }> {
  const audience = `//iam.googleapis.com/projects/${GOOGLE_ADS_WIF.projectNumber}/locations/global/workloadIdentityPools/${GOOGLE_ADS_WIF.poolId}/providers/${GOOGLE_ADS_WIF.providerId}`;

  const stsRes = await fetch("https://sts.googleapis.com/v1/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      audience,
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      scope: CLOUD_PLATFORM_SCOPE,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      subject_token: subjectToken,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const stsBody = await stsRes.json().catch(() => ({} as any));
  if (!stsRes.ok || !stsBody.access_token) {
    throw new Error(`Google STS rejected Vercel OIDC: ${googleError(stsBody, String(stsRes.status))}`);
  }

  const serviceAccount = encodeURIComponent(GOOGLE_ADS_WIF.serviceAccountEmail);
  const impersonateRes = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccount}:generateAccessToken`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${stsBody.access_token}`,
        "content-type": "application/json",
        "x-goog-user-project": GOOGLE_ADS_WIF.projectId,
      },
      body: JSON.stringify({ scope: [SCOPE], lifetime: "3600s" }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const impersonateBody = await impersonateRes.json().catch(() => ({} as any));
  if (!impersonateRes.ok || !impersonateBody.accessToken) {
    throw new Error(
      `Google service-account impersonation failed: ${googleError(impersonateBody, String(impersonateRes.status))}`,
    );
  }

  const expiresAt = impersonateBody.expireTime
    ? Date.parse(impersonateBody.expireTime)
    : Date.now() + 55 * 60_000;
  return { value: impersonateBody.accessToken, expiresAt };
}

/** Legacy service-account JSON-key flow retained only as a fallback. */
async function keyAccessToken(c: GoogleAdsConfig): Promise<{ value: string; expiresAt: number }> {
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
    throw new Error(`Google refused the service account key: ${googleError(body, String(res.status))}`);
  }
  return {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const oidc = env("VERCEL_OIDC_TOKEN");
  if (oidc) {
    cachedToken = await oidcAccessToken(oidc);
    return cachedToken.value;
  }

  const c = googleAdsConfig();
  if (!c.clientEmail || !c.privateKey) {
    throw new Error("No Google authentication is available: Vercel OIDC token and service-account key are both absent.");
  }
  cachedToken = await keyAccessToken(c);
  return cachedToken.value;
}

/* ------------------------------------------------------------- ingest */

export type ConversionPayload = {
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

export const MAX_ATTEMPTS = 6;

export function nextAttemptAt(attempts: number, from = new Date()): Date | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  const minutes = Math.pow(5, attempts) / 5;
  return new Date(from.getTime() + Math.min(minutes, 600) * 60_000);
}
