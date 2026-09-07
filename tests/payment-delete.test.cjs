const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

// Run the real server action with an isolated in-memory database. No live
// credentials or customer records are used by these regression tests.
const actionSource = ts.transpileModule(
  readFileSync(path.join(__dirname, "../src/app/(app)/admin-actions.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

class Redirect extends Error {
  constructor(url) { super(url); this.url = url; }
}

function setup({ role = "owner", databaseError = null } = {}) {
  const payments = [
    { id: "test-payment", booking_id: "booking-1", client_id: "client-1", amount_pesewas: 5000 },
    { id: "real-payment", booking_id: "booking-1", client_id: "client-1", amount_pesewas: 20000 },
  ];
  const refreshed = [];
  let connections = 0;
  const mocks = {
    "next/navigation": { redirect: (url) => { throw new Redirect(url); } },
    "next/cache": { revalidatePath: (...args) => refreshed.push(args) },
    "@/lib/auth": {
      requireRole: async (...allowed) => {
        if (!allowed.includes(role)) throw new Redirect("/");
        return { role };
      },
    },
    "@/lib/supabase/server": {
      supabaseServer: () => {
        connections++;
        return {
          from(table) {
            assert.equal(table, "payment");
            return {
              delete: () => ({
                eq(column, id) {
                  assert.equal(column, "id");
                  return {
                    select: () => ({
                      async maybeSingle() {
                        if (databaseError) return { data: null, error: databaseError };
                        const index = payments.findIndex((payment) => payment.id === id);
                        const removed = index < 0 ? null : payments.splice(index, 1)[0];
                        return { data: removed, error: null };
                      },
                    }),
                  };
                },
              }),
            };
          },
        };
      },
    },
  };
  const actionModule = { exports: {} };
  new Function("require", "module", "exports", actionSource)(
    (name) => {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
      return mocks[name];
    },
    actionModule, actionModule.exports,
  );
  return {
    ...actionModule.exports, payments, refreshed,
    get connections() { return connections; },
  };
}

function form(overrides = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    table: "payment", id: "test-payment", confirm: "DELETE",
    from: "/finance?from=2026-09-01&to=2026-09-07", ...overrides,
  })) data.set(key, value);
  return data;
}

async function destination(action, data) {
  try { await action(data); } catch (error) {
    if (error instanceof Redirect) return new URL(error.url, "https://crm.example");
    throw error;
  }
  assert.fail("The action should redirect with its outcome");
}

test("owner removes only the chosen payment, refreshes totals, and keeps date filters", async () => {
  const app = setup();
  const url = await destination(app.deleteRecord, form());
  assert.deepEqual(app.payments.map((p) => p.id), ["real-payment"]);
  assert.equal(app.payments.reduce((total, p) => total + p.amount_pesewas, 0), 20000);
  assert.equal(url.pathname, "/finance");
  assert.equal(url.searchParams.get("from"), "2026-09-01");
  assert.equal(url.searchParams.get("to"), "2026-09-07");
  assert.equal(url.searchParams.get("deleted"), "payment");
  for (const page of ["/finance", "/bookings", "/bookings/booking-1", "/clients", "/clients/client-1", "/partners", "/"]) {
    assert.ok(app.refreshed.some(([route]) => route === page), `${page} must refresh`);
  }
  assert.ok(app.refreshed.some(([route, type]) => route === "/partners/[id]" && type === "page"));
});

for (const role of ["officer", "therapist"]) {
  test(`${role} cannot delete a payment by posting directly to the action`, async () => {
    const app = setup({ role });
    const url = await destination(app.deleteRecord, form());
    assert.equal(url.pathname, "/");
    assert.equal(app.connections, 0);
    assert.equal(app.payments.length, 2);
  });
}

test("confirmation is enforced on the server and errors retain the selected range", async () => {
  const app = setup();
  const url = await destination(app.deleteRecord, form({ confirm: "yes" }));
  assert.match(url.searchParams.get("error"), /Type DELETE/);
  assert.equal(url.searchParams.get("from"), "2026-09-01");
  assert.equal(url.searchParams.get("to"), "2026-09-07");
  assert.equal(app.connections, 0);
  assert.equal(app.payments.length, 2);
});

test("missing or stale payment IDs cannot produce a success message", async () => {
  for (const id of ["", "already-removed"]) {
    const app = setup();
    const url = await destination(app.deleteRecord, form({ id }));
    assert.ok(url.searchParams.has("error"));
    assert.equal(url.searchParams.has("deleted"), false);
    assert.equal(app.payments.length, 2);
    assert.deepEqual(app.refreshed, []);
  }
});

test("a database refusal keeps the payment and shows the error", async () => {
  const app = setup({ databaseError: { code: "42501", message: "permission denied" } });
  const url = await destination(app.deleteRecord, form());
  assert.equal(url.searchParams.get("error"), "Only the owner can delete a payment.");
  assert.equal(app.payments.length, 2);
  assert.deepEqual(app.refreshed, []);
});

test("deleting from a booking returns there and clears an earlier error", async () => {
  const app = setup();
  const url = await destination(app.deleteRecord, form({ from: "/bookings/booking-1?error=old" }));
  assert.equal(url.pathname, "/bookings/booking-1");
  assert.equal(url.searchParams.has("error"), false);
  assert.equal(url.searchParams.get("deleted"), "payment");
});

test("unknown tables, including inherited object names, never reach the database", async () => {
  for (const table of ["app_user", "audit_log", "constructor"]) {
    const app = setup();
    const url = await destination(app.deleteRecord, form({ table }));
    assert.ok(url.searchParams.has("error"));
    assert.equal(app.connections, 0);
  }
});

test("a crafted return URL cannot redirect the owner to another site", async () => {
  for (const from of [
    "https://other.example/finance", "//other.example", "https://crm.local//other.example",
    "javascript:javascript:alert(1)", "https://%",
  ]) {
    const app = setup();
    const url = await destination(app.deleteRecord, form({ from }));
    assert.equal(url.origin, "https://crm.example");
    assert.equal(url.searchParams.get("deleted"), "payment");
  }
});
