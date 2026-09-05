/**
 * Single-process keyed concurrency lock.
 *
 * The acquire/release boundary is intentionally small so it can be replaced
 * with a distributed lock when the app is deployed with multiple instances.
 */
export function createConcurrencyLock() {
  const active = new Set();

  return {
    isActive(key) {
      return active.has(key);
    },

    acquire(key) {
      if (active.has(key)) return null;
      active.add(key);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active.delete(key);
      };
    },
  };
}