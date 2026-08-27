/**
 * Fixed-window in-memory rate limiter for the /api/ask route.
 *
 * Every request can cost an OpenAI API call, so a public deployment without
 * metering turns a leaked URL into someone else's API bill. This is a
 * best-effort single-instance guard — good enough to stop casual abuse and
 * runaway scripts; a multi-instance deployment should move this behind the
 * load balancer.
 */

export type RateLimitVerdict = {
  allowed: boolean;
  /** Seconds until the client may retry (0 when allowed). */
  retryAfterSeconds: number;
};

type Window = { startedAt: number; count: number };

const WINDOW_MS = 60_000;

export function createRateLimiter({
  maxPerMinute,
  now = () => Date.now(),
}: {
  maxPerMinute: number;
  now?: () => number;
}) {
  const windows = new Map<string, Window>();

  // Bound memory: if unique keys pile up beyond this many, drop expired
  // entries on the next request instead of growing forever.
  const MAX_TRACKED_KEYS = 10_000;

  return {
    check(key: string): RateLimitVerdict {
      const current = now();

      if (windows.size >= MAX_TRACKED_KEYS) {
        // Evict oldest entries in insertion order instead of clearing the
        // map, which would reset limits for currently-active clients.
        for (const [existingKey, window] of windows) {
          if (current - window.startedAt >= WINDOW_MS) {
            windows.delete(existingKey);
          }
        }
        while (windows.size >= MAX_TRACKED_KEYS) {
          const oldest = windows.keys().next();
          if (oldest.done) break;
          windows.delete(oldest.value);
        }
      }

      const window = windows.get(key);
      if (!window || current - window.startedAt >= WINDOW_MS) {
        windows.set(key, { startedAt: current, count: 1 });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      if (window.count < maxPerMinute) {
        window.count += 1;
        return { allowed: true, retryAfterSeconds: 0 };
      }

      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((window.startedAt + WINDOW_MS - current) / 1000),
      );
      return { allowed: false, retryAfterSeconds };
    },
  };
}

/**
 * Best-effort client identity for rate limiting. Behind a proxy that sets
 * x-forwarded-for this is spoofable by the proxy's own clients; that only
 * lets a client exhaust its own bucket, so it is acceptable here.
 */
export function clientKeyFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}
