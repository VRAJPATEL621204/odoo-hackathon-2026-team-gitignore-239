import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Tracks a short client-side cooldown per action key, with a live remaining
 * time so the UI can show "try again in 4:58" instead of just disabling the
 * button and leaving the user guessing why.
 *
 * The server is the real enforcement (it rejects with 429 + retryAfter once
 * the window is still open); this only keeps the button disabled so the user
 * is not left free to fire a request that is guaranteed to be rejected.
 */
export function useCooldown() {
  const until = useRef({});
  const intervalRef = useRef(null);
  const [, setTick] = useState(0);

  const stopTicking = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const ensureTicking = useCallback(() => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => {
      const now = Date.now();
      let anyActive = false;
      for (const [key, endsAt] of Object.entries(until.current)) {
        if (endsAt <= now) delete until.current[key];
        else anyActive = true;
      }
      setTick((n) => n + 1);
      if (!anyActive) stopTicking();
    }, 1000);
  }, [stopTicking]);

  useEffect(() => stopTicking, [stopTicking]);

  const start = useCallback(
    (key, seconds) => {
      if (!seconds || seconds <= 0) return;
      until.current[key] = Date.now() + seconds * 1000;
      setTick((n) => n + 1);
      ensureTicking();
    },
    [ensureTicking]
  );

  /** Cancels a cooldown early — used to roll back an optimistic lock when the
   * request it was guarding turned out to have failed for real. */
  const clear = useCallback((key) => {
    delete until.current[key];
    setTick((n) => n + 1);
  }, []);

  const remaining = useCallback((key) => {
    const endsAt = until.current[key];
    return endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : 0;
  }, []);

  const isActive = useCallback((key) => remaining(key) > 0, [remaining]);

  return { start, clear, isActive, remaining };
}

/** "4:58" for anything a minute or over, "8s" below that. */
export function formatCooldown(seconds) {
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${minutes}:${String(rest).padStart(2, '0')}`;
  }
  return `${seconds}s`;
}
