const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { generateKeyPairSync, verify } = require("node:crypto");
const { test } = require("node:test");
const ts = require("typescript");

function compile(file) {
  return ts.transpileModule(readFileSync(path.join(__dirname, "..", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

const readerSource = compile("src/lib/ga4.ts");
const actionSource = compile("src/app/(app)/marketing/actions.ts");
// Test-only credentials generated in memory; no Google account is contacted.
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = keys.privateKey.export({ type: "pkcs8", format: "pem" });
const traffic = [{
  day: "2026-09-06", channel_group: "Paid Search", source_medium: "google / cpc",
  campaign: "Accra", sessions: 12, active_users: 10, engaged_sessions: 8, key_events: 3,
}];

function reader({ configured = true, tokenError = false } = {}) {
  const requests = [];
  const env = {
    WINDSOR_API_KEY: "unused-test-value",
    ...(configured ? {
      GA4_PROPERTY_ID: "314693631",
      GA4_SA_CLIENT_EMAIL: "crm-reader@example.iam.gserviceaccount.com",
      GA4_SA_PRIVATE_KEY: key.replace(/\n/g, "\\n"),
    } : {}),
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "process", "fetch", readerSource)(
    (name) => {
      assert.equal(name, "node:crypto");
      return require(name);
    }, module, module.exports, { env }, async (url, options) => {
      requests.push({ url, options });
      if (url === "https://oauth2.googleapis.com/token") {
        const jwt = options.body.get("assertion");
        const [header, payload, signature] = jwt.split(".");
        assert.equal(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`),
          keys.publicKey, Buffer.from(signature, "base64url")), true);
        const claims = JSON.parse(Buffer.from(payload, "base64url"));
        assert.equal(claims.scope, "https://www.googleapis.com/auth/analytics.readonly");
        assert.equal(claims.iss, env.GA4_SA_CLIENT_EMAIL);
        assert.equal(claims.aud, url);
        return tokenError
          ? { ok: false, status: 403, json: async () => ({ error: "invalid_grant" }) }
          : { ok: true, json: async () => ({ access_token: "test-token" }) };
      }
      assert.equal(url, "https://analyticsdata.googleapis.com/v1beta/properties/314693631:runReport");
      assert.equal(options.headers.authorization, "Bearer test-token");
      return { ok: true, json: async () => ({ rows: [{
        dimensionValues: ["20260906", "Paid Search", "google / cpc", "Accra"].map(value => ({ value })),
        metricValues: ["12", "10", "8", "3"].map(value => ({ value })),
      }] }) };
    },
  );
  return { ...module.exports, requests };
}

test("direct GA4 import signs a read-only Google token and preserves Google's channel data", async () => {
  const app = reader();
  const result = await app.fetchGa4Daily(30);
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows, traffic);
  assert.equal(app.requests.length, 2);
  assert.deepEqual(JSON.parse(app.requests[1].options.body).dateRanges,
    [{ startDate: "30daysAgo", endDate: "1daysAgo" }]);
});

test("one-day import requests yesterday only", async () => {
  const app = reader();
  await app.fetchGa4Daily(1);
  assert.deepEqual(JSON.parse(app.requests[1].options.body).dateRanges,
    [{ startDate: "1daysAgo", endDate: "1daysAgo" }]);
});

test("a Windsor key cannot enable GA4 or trigger a fallback when Google credentials are absent", async () => {
  const app = reader({ configured: false });
  assert.equal(app.ga4ReadConfigured(), false);
  assert.equal((await app.fetchGa4Daily()).ok, false);
  assert.deepEqual(app.requests, []);
});

test("a Google authentication failure stops the import without contacting another provider", async () => {
  const app = reader({ tokenError: true });
  const result = await app.fetchGa4Daily();
  assert.equal(result.ok, false);
  assert.match(result.reason, /invalid_grant/);
  assert.equal(app.requests.length, 1);
});

class Redirect extends Error {
  constructor(url) { super(url); this.url = url; }
}

function actions({ role = "owner", result = { ok: true, rows: traffic }, statusError = null } = {}) {
  const state = { rows: [...traffic], status: {}, tables: [], reads: 0 };
  const mocks = {
    "next/navigation": { redirect: url => { throw new Redirect(url); } },
    "next/cache": { revalidatePath: () => {} },
    "@/lib/format": { toPesewas: value => Math.round(Number(value) * 100) },
    "@/lib/auth": { requireRole: async (...roles) => {
      if (!roles.includes(role)) throw new Redirect("/");
    } },
    "@/lib/ga4": { fetchGa4Daily: async () => { state.reads++; return result; } },
    "@/lib/supabase/server": { supabaseServer: () => ({ from: table => {
      state.tables.push(table);
      if (table === "ga4_daily") return {
        delete: () => ({ in: async (column, days) => {
          assert.equal(column, "day");
          state.rows = state.rows.filter(row => !days.includes(row.day));
          return { error: null };
        } }),
        insert: async rows => { state.rows.push(...rows); return { error: null }; },
      };
      assert.equal(table, "settings");
      return { update: values => ({ eq: async () => {
        if (!statusError) state.status = values;
        return { error: statusError };
      } }) };
    } }) },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "process", actionSource)(name => {
    assert.ok(Object.hasOwn(mocks, name), `Unexpected integration dependency: ${name}`);
    return mocks[name];
  }, module, module.exports, { env: { GA4_PROPERTY_ID: "314693631" } });
  return { ...module.exports, state };
}

async function run(app) {
  const form = new FormData();
  form.set("days", "30");
  try { await app.syncGa4(form); } catch (error) {
    if (error instanceof Redirect) return new URL(error.url, "https://crm.example");
    throw error;
  }
  assert.fail("Expected the sync result to redirect");
}

test("only the owner can start a Google import", async () => {
  const app = actions({ role: "officer" });
  assert.equal((await run(app)).pathname, "/");
  assert.equal(app.state.reads, 0);
  assert.deepEqual(app.state.tables, []);
});

test("repeating a successful Google import replaces traffic without importing ad spend", async () => {
  const app = actions();
  for (let i = 0; i < 2; i++) assert.match((await run(app)).searchParams.get("ok"), /directly from Google/);
  assert.deepEqual(app.state.rows, traffic);
  assert.equal(app.state.status.ga4_property_id, "314693631");
  assert.ok(app.state.status.ga4_last_sync_at);
  assert.ok(app.state.tables.every(table => ["ga4_daily", "settings"].includes(table)));
});

test("a failed Google read preserves existing traffic and its previous sync status", async () => {
  const app = actions({ result: { ok: false, reason: "Google access denied" } });
  assert.equal((await run(app)).searchParams.get("error"), "Google access denied");
  assert.deepEqual(app.state.rows, traffic);
  assert.deepEqual(app.state.tables, []);
});

test("failure to save sync metadata is reported instead of claiming success", async () => {
  const app = actions({ statusError: { message: "permission denied" } });
  const url = await run(app);
  assert.equal(url.searchParams.has("ok"), false);
  assert.match(url.searchParams.get("error"), /sync status failed/);
});
