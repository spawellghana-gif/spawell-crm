import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ send: vi.fn(), config: vi.fn(), configured: vi.fn() }));
vi.mock("../google-ads", async (original) => ({
  ...await original<typeof import("../google-ads")>(),
  sendConversion: mocks.send,
  googleAdsConfig: mocks.config,
  googleAdsConfigured: mocks.configured,
}));
import { processQueue } from "../conversions";

const event = (id: string) => ({
  id, status: "pending", dedup_key: `SPAWELL-${id}`, attempts: 0,
  next_attempt_at: "2026-01-01T00:00:00Z", conversion_at: "2026-01-01T00:00:00Z",
  value_pesewas: 45000, currency: "GHS", gclid: `click-${id}`,
});

function database(enabled = true) {
  const tables: Record<string, Record<string, any>[]> = {
    settings: [{ id: true, google_ads_sync_enabled: enabled }],
    conversion_event: [event("first"), event("second")],
    conversion_attempt: [],
  };
  const writes: string[] = [];
  const client = { from(table: string) {
    let operation = "select", patch: Record<string, any> = {}, limit = Infinity;
    const conditions: ((row: Record<string, any>) => boolean)[] = [];
    const execute = () => {
      const rows = tables[table].filter(row => conditions.every(test => test(row))).slice(0, limit);
      if (operation === "update") {
        writes.push(table);
        rows.forEach(row => Object.assign(row, patch));
      } else if (operation === "insert") {
        writes.push(table);
        tables[table].push({ ...patch });
      }
      return { data: rows.map(row => ({ ...row })), error: null };
    };
    const query: any = {
      select: () => query,
      update: (value: Record<string, any>) => { operation = "update"; patch = value; return query; },
      insert: (value: Record<string, any>) => { operation = "insert"; patch = value; return query; },
      eq: (key: string, value: unknown) => { conditions.push(row => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { conditions.push(row => values.includes(row[key])); return query; },
      lt: (key: string, value: any) => { conditions.push(row => row[key] < value); return query; },
      lte: (key: string, value: any) => { conditions.push(row => row[key] != null && row[key] <= value); return query; },
      order: () => query,
      limit: (value: number) => { limit = value; return query; },
      maybeSingle: async () => { const result = execute(); return { ...result, data: result.data[0] ?? null }; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(execute()).then(resolve),
    };
    return query;
  } };
  return { client: client as unknown as SupabaseClient, tables, writes };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured.mockReturnValue(true);
  mocks.config.mockReturnValue({ syncEnabled: true });
  mocks.send.mockResolvedValue({ ok: true, httpStatus: 200, response: { requestId: "test-upload" } });
});

describe("conversion queue controls", () => {
  it("the CRM Pause sync switch blocks uploads even when environment credentials are enabled", async () => {
    const db = database(false);
    const result = await processQueue(db.client);
    expect(result.attempted).toBe(0);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it("validation works while sending is off and leaves every real event unchanged", async () => {
    mocks.config.mockReturnValue({ syncEnabled: false });
    const db = database(false);
    const before = structuredClone(db.tables);
    const result = await processQueue(db.client, { validateOnly: true });
    expect(result).toMatchObject({ attempted: 2, synced: 0, failed: 0 });
    expect(result.note).toContain("2 validated");
    expect(mocks.send.mock.calls.every(call => call[1].validateOnly === true)).toBe(true);
    expect(db.tables).toEqual(before);
    expect(db.writes).toEqual([]);
  });

  it("failed validation neither consumes attempts nor removes the event from the real queue", async () => {
    mocks.send.mockResolvedValue({ ok: false, httpStatus: 400, error: "Invalid conversion action" });
    const db = database();
    const result = await processQueue(db.client, { validateOnly: true, limit: 1 });
    expect(result).toMatchObject({ attempted: 1, synced: 0, failed: 1 });
    expect(db.tables.conversion_event[0]).toMatchObject({ status: "pending", attempts: 0 });
    expect(db.writes).toEqual([]);
  });

  it("retrying a selected conversion sends that row and leaves the older queued row alone", async () => {
    const db = database();
    const result = await processQueue(db.client, { conversionId: "second", limit: 1 });
    expect(result.synced).toBe(1);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ transactionId: "SPAWELL-second" }), expect.anything());
    expect(db.tables.conversion_event[0].status).toBe("pending");
    expect(db.tables.conversion_event[1].status).toBe("synced");
    await processQueue(db.client, { conversionId: "second" });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
