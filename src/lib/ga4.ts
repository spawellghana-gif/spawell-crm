/**
 * Google Analytics 4, both directions.
 *
 * Everything here is inert until the environment variables are set, and every
 * function says plainly whether it ran or why it did not. A marketing
 * integration that fails silently is worse than none: you keep making
 * decisions from a page that looks fine and is quietly three weeks stale.
 *
 * Secrets come from the environment and never from the database, because the
 * database is readable by the app and this repository is in git.
 *
 *   GA4_PROPERTY_ID          e.g. 512345678  (the number, not "G-…")
 *   GA4_SA_CLIENT_EMAIL      service account, Viewer on the GA4 property
 *   GA4_SA_PRIVATE_KEY       its private key, newlines as \n
 *   GA4_MEASUREMENT_ID       G-XXXXXXXXXX, for sending conversions back
 *   GA4_API_SECRET           Measurement Protocol secret
 */

export type Ga4Row = {
  day: string;
  channel_group: string;
  source_medium: string;
  campaign: string;
  sessions: number;
  active_users: number;
  engaged_sessions: number;
  key_events: number;
};

export type Ga4Result =
  | { ok: true; rows: Ga4Row[]; from: string; to: string }
  | { ok: false; reason: string };

const env = (k: string) => (process.env[k] ?? "").trim();

export function ga4ReadConfigured(): boolean {
  return Boolean(env("GA4_PROPERTY_ID") && env("GA4_SA_CLIENT_EMAIL") && env("GA4_SA_PRIVATE_KEY"));
}

export function ga4SendConfigured(): boolean {
  return Boolean(env("GA4_MEASUREMENT_ID") && env("GA4_API_SECRET"));
}

/* ------------------------------------------------------------------ auth */

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * A Google access token from a service account key, signed here rather than
 * pulled in with the googleapis package.
 *
 * The official client is roughly 40 MB of dependency for one JWT and one HTTP
 * call, on a serverless function that is billed by cold start. Node's own
 * crypto signs RS256 perfectly well.
 */
async function accessToken(): Promise<string> {
  const { createSign } = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);

  const claim = {
    iss: env("GA4_SA_CLIENT_EMAIL"),
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const unsigned =
    `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(claim))}`;

  // Vercel's environment UI stores the key with literal \n; a key pasted into
  // a .env file keeps real newlines. Accept both.
  const key = env("GA4_SA_PRIVATE_KEY").replace(/\\n/g, "\n");
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const jwt = `${unsigned}.${base64url(signer.sign(key))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(
      `Google refused the service account: ${body.error_description ?? body.error ?? res.status}`,
    );
  }
  return body.access_token as string;
}

/* -------------------------------------------------------------- pull in */

/** Fetch daily traffic by channel. `days` counts back from yesterday. */
export async function fetchGa4Daily(days = 30): Promise<Ga4Result> {
  if (!ga4ReadConfigured()) {
    return { ok: false, reason: "GA4 is not connected yet — the property id and service account are not set." };
  }

  // GA4 keeps adjusting the current day for hours. Ending yesterday means a
  // synced number never changes under you after the fact.
  const to = `${days === 0 ? 0 : 1}daysAgo`;
  const from = `${days + 1}daysAgo`;

  try {
    const token = await accessToken();
    const res = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${env("GA4_PROPERTY_ID")}:runReport`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          dateRanges: [{ startDate: from, endDate: to }],
          dimensions: [
            { name: "date" },
            { name: "sessionDefaultChannelGroup" },
            { name: "sessionSourceMedium" },
            { name: "sessionCampaignName" },
          ],
          metrics: [
            { name: "sessions" },
            { name: "activeUsers" },
            { name: "engagedSessions" },
            { name: "keyEvents" },
          ],
          limit: 10000,
        }),
      },
    );

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, reason: body?.error?.message ?? `GA4 returned ${res.status}.` };
    }

    const rows: Ga4Row[] = (body.rows ?? []).map((r: any) => {
      const d = r.dimensionValues.map((v: any) => v.value);
      const m = r.metricValues.map((v: any) => Number(v.value) || 0);
      return {
        // GA4 hands back YYYYMMDD.
        day: `${d[0].slice(0, 4)}-${d[0].slice(4, 6)}-${d[0].slice(6, 8)}`,
        channel_group: d[1] || "(other)",
        source_medium: d[2] || "(not set)",
        campaign: d[3] || "(not set)",
        sessions: m[0], active_users: m[1], engaged_sessions: m[2], key_events: m[3],
      };
    });

    return { ok: true, rows, from, to };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "GA4 request failed." };
  }
}

/* ------------------------------------------------------------- send out */

/**
 * Report a booking to GA4 as an offline conversion.
 *
 * `clientId` should be the GA client id captured on the website form. When an
 * enquiry arrived by WhatsApp or phone there is no such id — GA4 requires one
 * regardless, so a stable synthetic id derived from the booking is used. Those
 * conversions land as their own users rather than being attributed to a visit,
 * which is the honest answer: nobody knows which visit they came from.
 */
export async function sendBookingToGa4(opts: {
  clientId: string;
  sessionId?: string;
  bookingRef: string;
  valuePesewas: number;
  serviceName: string;
}): Promise<{ ok: boolean; reason?: string; attributed: boolean }> {
  if (!ga4SendConfigured()) {
    return { ok: false, reason: "GA4 conversion sending is not configured.", attributed: false };
  }

  const attributed = Boolean(opts.clientId);
  const clientId = opts.clientId || `crm.${opts.bookingRef}`;

  try {
    const res = await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(env("GA4_MEASUREMENT_ID"))}&api_secret=${encodeURIComponent(env("GA4_API_SECRET"))}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          // Not a real timestamp of the visit; GA4 only accepts events within
          // 72 hours, and a booking is confirmed well inside that window.
          events: [{
            name: "purchase",
            params: {
              transaction_id: opts.bookingRef,
              value: opts.valuePesewas / 100,
              currency: "GHS",
              items: [{ item_name: opts.serviceName, price: opts.valuePesewas / 100, quantity: 1 }],
              ...(opts.sessionId ? { session_id: opts.sessionId } : {}),
              engagement_time_msec: 1,
            },
          }],
        }),
      },
    );

    // The Measurement Protocol answers 204 on success and does not validate.
    // Use the /debug/mp/collect endpoint when a payload needs checking.
    if (res.status !== 204 && !res.ok) {
      return { ok: false, reason: `GA4 returned ${res.status}.`, attributed };
    }
    return { ok: true, attributed };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Send failed.", attributed };
  }
}
