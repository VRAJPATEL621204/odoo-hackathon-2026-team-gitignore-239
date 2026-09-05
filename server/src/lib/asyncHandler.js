/**
 * Express 4 does not catch rejected promises from route handlers, so an async
 * handler that throws would become an unhandled rejection instead of a 500.
 * Wrapping every async route in this forwards the error to the error
 * middleware and keeps try/catch out of the route files entirely.
 */
export function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
