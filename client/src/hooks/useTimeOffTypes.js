import { api } from '../api/client.js';
import { useResource } from './useResource.js';

/**
 * The active time off types, for the pickers on the request and allocation
 * forms.
 *
 * Separate from useOptions because the HR forms have no use for leave types,
 * and the time off screens have no use for salary schedules.
 */
export function useTimeOffTypes() {
  const { data, loading, error, refetch } = useResource(
    (signal) => api.get('/time-off/type-options', { signal }),
    []
  );

  const items = data?.items ?? [];
  return {
    loading,
    error,
    refetch,
    types: items,
    byId: (id) => items.find((type) => String(type.id) === String(id)) ?? null,
  };
}

/** "Days" or "Hours" for a unit, so the word is spelled in one place. */
export function unitLabel(unit, { plural = true } = {}) {
  if (unit === 'HOURS') return plural ? 'hours' : 'hour';
  return plural ? 'days' : 'day';
}
