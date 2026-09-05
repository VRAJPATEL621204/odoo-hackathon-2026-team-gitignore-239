import { useEffect, useState } from 'react';

/**
 * Delays a fast-changing value, so a search box fires one request when typing
 * stops rather than one per keystroke.
 */
export function useDebounced(value, delayMs = 250) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
