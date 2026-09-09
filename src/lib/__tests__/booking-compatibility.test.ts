import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ database: vi.fn(), service: vi.fn(), queue: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: mocks.database }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ id: "staff-id", role: "officer" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock("../conversions", () => ({
  serviceClient: mocks.service,
  ensureConversionForBooking: mocks.queue,
  voidConversionForBooking: vi.fn(),
}));
import { setBookingStatus } from "@/app/(app)/bookings/actions";
import { createEnquiry } from "@/app/(app)/enquiries/actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.service.mockReturnValue(null);
});

describe("existing CRM database compatibility", () => {
  it("a booking still confirms before the optional attribution migration", async () => {
    let savedPatch: Record<string, unknown> = {};
    mocks.database.mockReturnValue({ from(table: string) {
      if (table === "booking_event") return { insert: async () => ({ error: null }) };
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "booking-id", ref: "BKG-1", status: "awaiting_confirmation" }, error: null }) }) }),
        update: (patch: Record<string, unknown>) => {
          savedPatch = patch;
          return { eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: "booking-id" }, error: null }) }) }) };
        },
      };
    } });
    const form = new FormData();
    form.set("booking_id", "booking-id"); form.set("status", "confirmed");
    await setBookingStatus(form);
    expect(savedPatch).toEqual({ status: "confirmed" });
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("an RLS-filtered booking never reaches the privileged conversion hook", async () => {
    mocks.database.mockReturnValue({ from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }) });
    const form = new FormData();
    form.set("booking_id", "not-visible"); form.set("status", "confirmed");
    await expect(setBookingStatus(form)).rejects.toThrow("Booking%20not%20found");
    expect(mocks.service).not.toHaveBeenCalled();
  });

  it("a new enquiry saves without including columns from the unapplied migration", async () => {
    let inserted: Record<string, unknown> = {};
    mocks.database.mockReturnValue({ from(table: string) {
      if (table === "client") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
      return {
        select: () => ({ limit: async () => ({ error: { code: "42703", message: "column ad_click_id does not exist" } }) }),
        insert: (row: Record<string, unknown>) => {
          inserted = row;
          return { select: () => ({ single: async () => ({ data: { id: "enquiry-id" }, error: null }) }) };
        },
      };
    } });
    const form = new FormData();
    form.set("phone", "+233244010101"); form.set("full_name", "Test Customer");
    await expect(createEnquiry(form)).rejects.toThrow("REDIRECT /enquiries/enquiry-id");
    expect(inserted).toMatchObject({ status: "new", source: "direct_unknown" });
    expect(inserted).not.toHaveProperty("ad_click_id");
    expect(inserted).not.toHaveProperty("gclid");
  });
});
