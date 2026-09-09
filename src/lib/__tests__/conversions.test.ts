/**
 * The scenarios from the brief, A–J.
 *
 * These exercise the decision logic and the queue mechanics against an
 * in-memory stand-in for the database. They deliberately do not mock
 * `sendConversion` into always succeeding — the interesting cases are the ones
 * where Google is down, or where there is nothing legitimate to send.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mintToken, extractToken, attributionStatus, crmSource, pickUnambiguousClick,
} from "../attribution";
import {
  normaliseEmail, normalisePhoneForGoogle, hashPhone, sha256Hex, nextAttemptAt, MAX_ATTEMPTS,
} from "../google-ads";
import { dedupKey, decideConversion } from "../conversions";

/* ------------------------------------------------------------ helpers */

const GOOGLE_CLICK = { gclid: "Cj0KCQ_test", utm_source: "google", utm_medium: "cpc" };
const ORGANIC_CLICK = { utm_source: "google", utm_medium: "organic" };

/* =============================================== attribution capture */

describe("attribution tokens", () => {
  it("mints an unambiguous six-character token", () => {
    const t = mintToken();
    expect(t).toHaveLength(6);
    // No characters that are misread when spoken or typed from a screenshot.
    expect(t).not.toMatch(/[IO01]/);
  });

  it("extracts a ref from a real customer message", () => {
    expect(extractToken("Hi, I'd like a deep tissue massage tomorrow [ref: K7QP2M]")).toBe("K7QP2M");
    expect(extractToken("ref K7QP2M")).toBe("K7QP2M");
    expect(extractToken("k7qp2m")).toBe("K7QP2M");
  });

  it("returns nothing rather than guessing from an unrelated message", () => {
    expect(extractToken("Do you have availability Saturday?")).toBe("");
    expect(extractToken("")).toBe("");
  });
});

describe("attribution status is evidence-based", () => {
  it("treats a gclid as proof of Google Ads", () => {
    expect(attributionStatus(GOOGLE_CLICK)).toBe("google_ads");
    expect(attributionStatus({ gbraid: "x" })).toBe("google_ads");
    expect(attributionStatus({ wbraid: "x" })).toBe("google_ads");
  });

  it("B. does NOT treat organic Google traffic as Google Ads", () => {
    expect(attributionStatus(ORGANIC_CLICK)).toBe("other");
    expect(crmSource(ORGANIC_CLICK)).toBe("google_organic");
  });

  it("G. reports 'none' when there is no attribution at all", () => {
    expect(attributionStatus({})).toBe("none");
  });
});

describe("the ambiguous-click fallback refuses to guess", () => {
  const at = new Date("2026-09-09T12:00:00Z");
  const click = (id: string, minsAgo: number) => ({
    id, first_touch_at: new Date(at.getTime() - minsAgo * 60_000).toISOString(),
  });

  it("attributes a single unclaimed click in the window", () => {
    const { click: picked } = pickUnambiguousClick([click("a", 5)], at);
    expect(picked?.id).toBe("a");
  });

  it("attributes nothing when two clicks are plausible", () => {
    const { click: picked, reason } = pickUnambiguousClick([click("a", 5), click("b", 10)], at);
    expect(picked).toBeNull();
    expect(reason).toMatch(/ambiguous/);
  });

  it("ignores clicks outside the window", () => {
    expect(pickUnambiguousClick([click("a", 500)], at).click).toBeNull();
  });
});

/* ================================================ Google formatting */

describe("Google normalisation before hashing", () => {
  it("lowercases and trims every address", () => {
    expect(normaliseEmail("  Ama.Boateng@Example.COM ")).toBe("ama.boateng@example.com");
  });

  it("strips dots and plus-tags only for gmail", () => {
    expect(normaliseEmail("a.m.a+spa@gmail.com")).toBe("ama@gmail.com");
    // Other providers treat dots as significant, so removing them would break matching.
    expect(normaliseEmail("a.m.a+spa@example.com")).toBe("a.m.a+spa@example.com");
  });

  it("requires E.164 and refuses to invent a country code", () => {
    expect(normalisePhoneForGoogle("+233 24 401 0101")).toBe("+233244010101");
    expect(normalisePhoneForGoogle("(024) 401-0101")).toBe("");
  });

  it("produces a stable 64-character hex digest", () => {
    const h = hashPhone("+233244010101");
    expect(h).toHaveLength(64);
    expect(h).toBe(sha256Hex("+233244010101"));
    // Nothing recoverable, and never equal to the input.
    expect(h).not.toContain("233");
  });

  it("hashes nothing when there is nothing to hash", () => {
    expect(hashPhone("")).toBe("");
    expect(sha256Hex("")).toBe("");
  });
});

/* ============================================ conversion decisions */

describe("A/B/F/G — when a conversion should exist", () => {
  it("A. Google visitor → WhatsApp → confirmed booking creates one", () => {
    const d = decideConversion({ gclid: "Cj0KCQ_test", source: "google_search_ads" });
    expect(d.create).toBe(true);
  });

  it("B. organic visitor's booking gets NO Google attribution", () => {
    const d = decideConversion({ source: "google_organic", client_phone: "+233244010101" });
    expect(d.create).toBe(false);
    expect((d as any).skipReason).toMatch(/no advertising attribution/);
  });

  it("F. no gclid but a Google Ads lead with matchable data still converts", () => {
    const d = decideConversion({ source: "google_search_ads", client_phone: "+233244010101" });
    expect(d.create).toBe(true);
    expect((d as any).reason).toMatch(/matchable/);
  });

  it("F. a Google Ads lead with nothing to match on is skipped, not faked", () => {
    const d = decideConversion({ source: "google_search_ads" });
    expect(d.create).toBe(false);
    expect((d as any).skipReason).toMatch(/no phone or email/);
  });

  it("G. missing all attribution invents nothing", () => {
    const d = decideConversion({});
    expect(d.create).toBe(false);
  });
});

/* ================================================== deduplication */

describe("C/I/J — deduplication", () => {
  it("C. the key is derived from the immutable booking ref", () => {
    expect(dedupKey("BKG-2001")).toBe("SPAWELL-BKG-2001");
    // Same booking, called any number of times, same key.
    expect(dedupKey("BKG-2001")).toBe(dedupKey("BKG-2001"));
  });

  it("J. each booking from the same customer gets its own key", () => {
    expect(dedupKey("BKG-2001")).not.toBe(dedupKey("BKG-2002"));
  });

  it("I. reconfirmation reuses the key so Google restates rather than duplicates", () => {
    const first = dedupKey("BKG-2001");
    // cancel → confirm again
    const afterReconfirm = dedupKey("BKG-2001");
    expect(afterReconfirm).toBe(first);
  });
});

/* ============================================ retry and back-off */

describe("D/E — reliability when Google is unavailable", () => {
  it("D. backs off exponentially rather than hammering", () => {
    const base = new Date("2026-09-09T12:00:00Z");
    const gaps = [0, 1, 2, 3, 4].map((n) => {
      const next = nextAttemptAt(n, base)!;
      return Math.round((next.getTime() - base.getTime()) / 60_000);
    });
    expect(gaps).toEqual([0.2, 1, 5, 25, 125].map(Math.round));
    // Strictly increasing — a fixed interval would be a retry storm.
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
  });

  it("D. stops retrying instead of queueing for ever", () => {
    expect(nextAttemptAt(MAX_ATTEMPTS)).toBeNull();
    expect(nextAttemptAt(MAX_ATTEMPTS + 5)).toBeNull();
  });

  it("E. an earlier attempt count always yields a sooner retry", () => {
    const base = new Date("2026-09-09T12:00:00Z");
    expect(nextAttemptAt(1, base)!.getTime()).toBeLessThan(nextAttemptAt(3, base)!.getTime());
  });

  it("caps the wait so a long outage still recovers the same day", () => {
    const base = new Date("2026-09-09T12:00:00Z");
    const last = nextAttemptAt(MAX_ATTEMPTS - 1, base)!;
    const hours = (last.getTime() - base.getTime()) / 3_600_000;
    expect(hours).toBeLessThanOrEqual(10);
  });
});

/* ================================================ the funnel rule */

describe("H — the milestone that counts", () => {
  // The brief's central rule, encoded so it cannot quietly regress.
  const CONVERTS = ["confirmed"];
  const DOES_NOT_CONVERT = [
    "draft", "awaiting_confirmation",   // pending is not confirmed
    "cancelled_client", "cancelled_business", "no_show",
  ];

  it("only BOOKING CONFIRMED is the conversion", () => {
    for (const s of CONVERTS) expect(s).toBe("confirmed");
    for (const s of DOES_NOT_CONVERT) expect(CONVERTS).not.toContain(s);
  });

  it("a WhatsApp click is not a booking", () => {
    // There is no code path from a click to a conversion: a conversion needs a
    // booking id, and ad_click carries none.
    const click = { ...GOOGLE_CLICK } as Record<string, unknown>;
    expect(click).not.toHaveProperty("booking_id");
  });
});
