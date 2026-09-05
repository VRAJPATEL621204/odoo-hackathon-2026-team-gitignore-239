import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads data for a screen.
 *
 * Covers the whole of our data access pattern — independent list and detail
 * screens — which is why there is no data-fetching library in the project.
 * Requests are aborted when the dependencies change or the component unmounts,
 * so a fast typist never sees an older response overwrite a newer one.
 *
 * `fetcher` receives an AbortSignal and must pass it to the api call.
 */
export function useResource(fetcher, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const controllerRef = useRef(null);

  // Keeping the fetcher in a ref lets callers pass an inline arrow function
  // without it becoming a dependency that re-triggers the effect every render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setState((previous) => ({ ...previous, loading: true, error: null }));
    try {
      const data = await fetcherRef.current(controller.signal);
      if (controller.signal.aborted) return;
      setState({ data, loading: false, error: null });
    } catch (error) {
      if (error?.name === 'AbortError' || controller.signal.aborted) return;
      setState({ data: null, loading: false, error });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
    return () => controllerRef.current?.abort();
  }, [load]);

  return { ...state, refetch: load, setData: (data) => setState({ data, loading: false, error: null }) };
}
