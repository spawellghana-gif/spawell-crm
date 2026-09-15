import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), supabaseServer: vi.fn(), processQueue: vi.fn(),
  backfill: vi.fn(), prepare: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: mocks.supabaseServer }));
vi.mock("@/lib/conversions", () => ({
  processQueue: mocks.processQueue, backfillMissingConversions: mocks.backfill,
  refreshConversionStatuses: vi.fn(),
}));
vi.mock("@/lib/google-ads-runtime", () => ({ prepareGoogleAdsRuntime: mocks.prepare }));
vi.mock("@/lib/google-ads", () => ({ googleAdsConfig: vi.fn(), googleAdsMissing: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
import { retryConversions } from "@/app/(app)/marketing/google-ads/actions";

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("CRON_SECRET", "test-only-cron-secret");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-database-secret");
  mocks.requireRole.mockResolvedValue({ role: "owner" });
  mocks.prepare.mockResolvedValue({ ok: true });
  mocks.processQueue.mockResolvedValue({ attempted: 0, synced: 0, failed: 0, note: "No conversions due" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("owner sync through the automatic worker", () => {
  it("rejects non-owners before using server credentials", async () => {
    mocks.requireRole.mockRejectedValue(new Error("Forbidden"));
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(retryConversions(new FormData())).rejects.toThrow("Forbidden");
    expect(mocks.requireRole).toHaveBeenCalledWith("owner");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.supabaseServer).not.toHaveBeenCalled();
  });

  it("pins the destination and refuses redirects while exercising the real worker", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ attempted: 0, synced: 0, failed: 0, note: "No conversions due" }));
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData(); form.set("url", "https://untrusted.example/sync");
    await expect(retryConversions(form)).rejects.toThrow("ok=Automatic%20worker%3A%20No%20conversions%20due");
    expect(fetchMock).toHaveBeenCalledWith("https://crm.spawellghana.com/api/conversions/sync", expect.objectContaining({
      method: "GET", headers: { authorization: "Bearer test-only-cron-secret" }, redirect: "error", cache: "no-store",
    }));
    expect(mocks.processQueue).not.toHaveBeenCalled();
    expect(mocks.supabaseServer).not.toHaveBeenCalled();
  });

  it("reports invalid worker credentials instead of silently using the owner session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Server credentials are not configured." }, { status: 503 })));
    await expect(retryConversions(new FormData())).rejects.toThrow("error=Automatic%20sync%3A%20Server%20credentials");
    expect(mocks.supabaseServer).not.toHaveBeenCalled();
    expect(mocks.processQueue).not.toHaveBeenCalled();
  });

  it("does not expose request details when the network rejects the request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("test-only-cron-secret")));
    let failure = "";
    try { await retryConversions(new FormData()); } catch (e) { failure = String(e); }
    expect(failure).toContain("automatic%20worker%20could%20not%20be%20reached");
    expect(failure).not.toContain("test-only-cron-secret");
  });

  it("keeps preview requests within their own database and never sends a secret to production", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(retryConversions(new FormData())).rejects.toThrow("ok=No%20conversions%20due");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.processQueue).toHaveBeenCalledOnce();
  });
});
