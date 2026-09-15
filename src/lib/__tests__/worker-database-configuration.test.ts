import { afterEach, describe, expect, it, vi } from "vitest";
import { workerDatabaseConfigurationError } from "../conversions";

afterEach(() => vi.unstubAllEnvs());
const token = (role: string) => `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.private-signature`;

describe("automatic worker database credentials", () => {
  it.each(["sb_publishable_test-only", token("anon")])("rejects a public key without exposing its value", (key) => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", key);
    const error = workerDatabaseConfigurationError();
    expect(error).toContain("contains a public key");
    expect(error).not.toContain(key);
    expect(error).not.toContain("private-signature");
  });

  it.each(["sb_secret_test-only", token("service_role")])("leaves server-key authentication to Supabase", (key) => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", key);
    expect(workerDatabaseConfigurationError()).toBeNull();
  });
});
