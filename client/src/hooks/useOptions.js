import { api } from '../api/client.js';
import { useResource } from './useResource.js';

/**
 * The pickers every HR form needs: departments, job positions, schedules,
 * employees and the company name.
 *
 * One endpoint rather than four requests per form, and one hook so no screen
 * invents its own shape for the same lists.
 */
export function useOptions() {
  const { data, loading, error, refetch } = useResource(
    (signal) => api.get('/hr/options', { signal }),
    []
  );

  return {
    loading,
    error,
    refetch,
    departments: data?.departments ?? [],
    jobPositions: data?.jobPositions ?? [],
    schedules: data?.schedules ?? [],
    employees: data?.employees ?? [],
    weekdays: data?.weekdays ?? [],
    company: data?.company ?? '',
  };
}

/** Turns `[{ id, name }]` into the `[{ value, label }]` a select expects. */
export function toSelectOptions(rows, labelKey = 'name') {
  return rows.map((row) => ({ value: String(row.id), label: row[labelKey] }));
}
