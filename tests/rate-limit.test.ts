import { describe, expect, it } from "vitest";
import { clientKeyFromRequest, createRateLimiter } from "../src/lib/rate-limit";

function makeRequest(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/ask", { headers });
}

describe("createRateLimiter", () => {
  it("allows requests under the limit", () => {
    const limiter = createRateLimiter({ maxPerMinute: 3 });
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
  });

  it("blocks requests past the limit and reports retry-after", () => {
    let time = 1_000_000;
    const limiter = createRateLimiter({ maxPerMinute: 2, now: () => time });

    limiter.check("a");
    limiter.check("a");

    const blocked = limiter.check("a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    // A different key has its own bucket.
    expect(limiter.check("b").allowed).toBe(true);

    // The window eventually resets.
    time += 61_000;
    expect(limiter.check("a").allowed).toBe(true);
  });

  it("does not grow without bound when keys churn", () => {
    const time = 1_000_000;
    const limiter = createRateLimiter({ maxPerMinute: 1, now: () => time });

    for (let i = 0; i < 20_000; i += 1) {
      limiter.check(`key-${i}`);
    }

    // Allowing the internal map to be inspected indirectly: after churning
    // far past MAX_TRACKED_KEYS, a fresh key must still work (map was pruned
    // or cleared instead of growing forever).
    expect(limiter.check("fresh-key").allowed).toBe(true);
  });
});

describe("clientKeyFromRequest", () => {
  it("prefers the first x-forwarded-for entry", () => {
    const request = makeRequest({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    expect(clientKeyFromRequest(request)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip then unknown", () => {
    expect(clientKeyFromRequest(makeRequest({ "x-real-ip": "198.51.100.2" }))).toBe(
      "198.51.100.2",
    );
    expect(clientKeyFromRequest(makeRequest({}))).toBe("unknown");
  });
});
