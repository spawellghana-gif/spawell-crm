import { afterEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ token: vi.fn() }));
vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: sdk.token }));
import { sendConversion, vercelIdentitySummary } from "../google-ads";

const jwt = (claims: object) => `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.private-signature`;
const payload = { transactionId: "test-never-uploaded", conversionAt: "2026-09-14T00:00:00Z", valuePesewas: 20000, currency: "GHS", gclid: "local-test" };

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("Vercel runtime identity", () => {
  it("uses the SDK's function identity even if an environment token exists", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "wrong-environment-token");
    vi.stubEnv("GOOGLE_ADS_CUSTOMER_ID", "123");
    vi.stubEnv("GOOGLE_ADS_CONVERSION_ACTION", "456");
    const token = jwt({ owner_id: "team_test", project_id: "prj_test", environment: "production" });
    sdk.token.mockResolvedValue(token);
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400,
      json: async () => ({ error_description: "The given credential is rejected by the attribute condition." }) });
    vi.stubGlobal("fetch", fetchMock);
    const result = await sendConversion(payload);
    expect(sdk.token).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].body.get("subject_token")).toBe(token);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("project_id=prj_test");
    expect(result.error).not.toContain(token);
    expect(result.error).not.toContain("private-signature");
    expect(result.error).not.toContain("wrong-environment-token");
  });

  it("never falls back to a legacy key when the hosted SDK cannot obtain a token", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("GOOGLE_ADS_CUSTOMER_ID", "123");
    vi.stubEnv("GOOGLE_ADS_CONVERSION_ACTION", "456");
    vi.stubEnv("GOOGLE_ADS_SA_CLIENT_EMAIL", "legacy@example.test");
    vi.stubEnv("GOOGLE_ADS_SA_PRIVATE_KEY", "must-not-be-used");
    sdk.token.mockRejectedValue(new Error("opaque-secret-in-unexpected-error"));
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const result = await sendConversion(payload);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("OIDC token unavailable");
    expect(result.error).not.toContain("opaque-secret");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("excludes arbitrary token claims and malformed tokens from diagnostics", () => {
    expect(vercelIdentitySummary(jwt({ project_id: "prj_test", secret: "do-not-disclose", email: "private@example.test" })))
      .toBe("project_id=prj_test");
    expect(vercelIdentitySummary("not-a-token")).toBe("identity metadata unavailable");
    expect(vercelIdentitySummary(jwt({ project_id: "unsafe arbitrary data", sub: "private@example.test" })))
      .toBe("identity metadata unavailable");
  });
});
