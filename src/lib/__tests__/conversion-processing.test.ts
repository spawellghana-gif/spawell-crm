import { describe, it, expect } from "vitest";
import { parseConversionStatus } from "../google-ads";

const destination = { customerId: "123", conversionAction: "456" };
const response = (requestStatus: string, extra = {}) => ({ requestStatusPerDestination: [{
  destination: { operatingAccount: { accountType: "GOOGLE_ADS", accountId: "123" }, productDestinationId: "456" },
  requestStatus, ...extra,
}] });

describe("Google processing results", () => {
  it("an upload receipt alone proves no processing success", () => {
    expect(parseConversionStatus({ requestId: "receipt" }, destination).status).toBe("unknown");
  });
  it.each([["SUCCESS", "success"], ["PROCESSING", "processing"], ["PARTIAL_SUCCESS", "partial_success"]])(
    "preserves Google's %s processing result", (raw, expected) => {
      expect(parseConversionStatus(response(raw), destination).status).toBe(expected);
    });
  it("surfaces rejected records without marking them successfully processed", () => {
    const r = parseConversionStatus(response("FAILED", { errorInfo: {
      errorCounts: [{ reason: "PROCESSING_ERROR_REASON_UNKNOWN_CONSENT", recordCount: "1" }],
    } }), destination);
    expect(r.status).toBe("failed");
    expect(r.error).toBe("UNKNOWN_CONSENT: 1");
  });
  it("rejects a success for a different account or conversion action", () => {
    expect(parseConversionStatus(response("SUCCESS"), { ...destination, customerId: "other" }).status).toBe("unknown");
    expect(parseConversionStatus(response("SUCCESS"), { ...destination, conversionAction: "other" }).status).toBe("unknown");
  });
});
