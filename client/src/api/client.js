/**
 * The single place the frontend talks to the API.
 *
 * Every response passes through here, so error shapes are normalised once and
 * every screen can rely on `ApiError` having `status`, `code`, `message` and
 * optional `fields`.
 */

export class ApiError extends Error {
  constructor(status, code, message, fields, retryAfter) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields ?? null;
    this.retryAfter = retryAfter ?? null;
  }
}

/** Thrown when the browser could not reach the server at all. */
export class NetworkError extends Error {
  constructor() {
    super('Cannot reach the server. Check that the backend is running on port 5000.');
    this.name = 'NetworkError';
    this.status = 0;
    this.code = 'NETWORK';
    this.fields = null;
  }
}

function buildUrl(path, query) {
  const url = `/api${path}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const queryString = params.toString();
  return queryString ? `${url}?${queryString}` : url;
}

async function request(method, path, { body, query, signal } = {}) {
  let response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      // Sends and accepts the httpOnly session cookie.
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    // An aborted request is a superseded one, not a failure to report.
    if (error?.name === 'AbortError') throw error;
    throw new NetworkError();
  }

  if (response.status === 204) return null;

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    const details = payload?.error;
    const retryAfter = Number(details?.retryAfter ?? response.headers.get('retry-after')) || null;

    // The API always answers with JSON. A non-JSON 5xx means the request never
    // reached it — in development that is the Vite proxy reporting that the
    // backend is not listening, which deserves a message the user can act on.
    if (!details && response.status >= 500) {
      throw new NetworkError();
    }

    throw new ApiError(
      response.status,
      details?.code ?? 'UNKNOWN',
      response.status === 429 && retryAfter
        ? `${details?.message ?? 'Too many requests.'} Please wait ${retryAfter} seconds.`
        : details?.message ?? `Request failed with status ${response.status}.`,
      details?.fields,
      retryAfter
    );
  }

  return payload;
}

async function download(path, { signal } = {}) {
  let response;
  try {
    response = await fetch(buildUrl(path), { credentials: 'include', signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new NetworkError();
  }

  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json') ? await response.json() : null;
    const details = payload?.error;
    const retryAfter = Number(details?.retryAfter ?? response.headers.get('retry-after')) || null;
    const message =
      response.status === 429 && retryAfter
        ? `${details?.message ?? 'Too many requests.'} Please wait ${retryAfter} seconds.`
        : details?.message ?? `Request failed with status ${response.status}.`;
    throw new ApiError(response.status, details?.code ?? 'UNKNOWN', message, details?.fields, retryAfter);
  }

  return response.blob();
}

export const api = {
  get: (path, options) => request('GET', path, options),
  post: (path, body, options) => request('POST', path, { ...options, body }),
  patch: (path, body, options) => request('PATCH', path, { ...options, body }),
  put: (path, body, options) => request('PUT', path, { ...options, body }),
  delete: (path, options) => request('DELETE', path, options),
  download,
};
