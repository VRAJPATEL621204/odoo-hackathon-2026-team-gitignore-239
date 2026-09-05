/**
 * A fixed-window counter used to throttle sign-in attempts.
 *
 * In-memory on purpose: the application runs as a single process, and the goal
 * is to stop password guessing against one account, not to survive a
 * distributed attack. Entries are pruned lazily on each hit so the map cannot
 * grow without bound.
 */
export function createRateLimiter({ limit, windowMs }) {
  const hits = new Map();

  function prune(now) {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }

  return {
    /** Records an attempt. Returns `{ allowed, retryAfterSeconds }`. */
    check(key) {
      const now = Date.now();
      prune(now);

      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      entry.count += 1;
      if (entry.count > limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
        };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },

    /** Clears the counter for a key after a successful attempt. */
    reset(key) {
      hits.delete(key);
    },
  };
}
