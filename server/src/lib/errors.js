/**
 * The single error type every layer of the server throws.
 *
 * `status` is the HTTP status, `code` is a stable machine-readable string the
 * frontend maps to a specific message, and `fields` carries per-field messages
 * for form validation so the UI can place them under the right input.
 */
export class AppError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (fields) this.fields = fields;
  }
}

export function badRequest(message, code = 'BAD_REQUEST') {
  return new AppError(400, code, message);
}

export function unauthorized(message = 'You are not signed in.', code = 'UNAUTHORIZED') {
  return new AppError(401, code, message);
}

export function forbidden(message = 'You do not have permission to do this.', code = 'FORBIDDEN') {
  return new AppError(403, code, message);
}

export function notFound(what = 'Record') {
  return new AppError(404, 'NOT_FOUND', `${what} not found.`);
}

/** Business-rule violations: the request was well formed but the domain refuses it. */
export function conflict(code, message) {
  return new AppError(409, code, message);
}

/** Field-level input problems. `fields` is `{ fieldName: 'message' }`. */
export function validationError(fields, message = 'Please correct the highlighted fields.') {
  return new AppError(422, 'VALIDATION_ERROR', message, fields);
}

export function tooManyRequests(message, code = 'TOO_MANY_REQUESTS') {
  return new AppError(429, code, message);
}
