import { randomUUID } from 'node:crypto';
import { AppError } from './errors.js';

/**
 * Prisma error codes we can translate into something a user can act on.
 * Anything else falls through to the generic 500 handler.
 * https://www.prisma.io/docs/orm/reference/error-reference
 */
const PRISMA_UNIQUE_VIOLATION = 'P2002';
const PRISMA_FOREIGN_KEY_VIOLATION = 'P2003';
const PRISMA_RECORD_NOT_FOUND = 'P2025';
const PRISMA_WRITE_CONFLICT = 'P2034';

function fieldsFromUniqueTarget(error) {
  const target = error?.meta?.target;
  const columns = Array.isArray(target) ? target : typeof target === 'string' ? [target] : [];
  if (columns.length === 0) return undefined;
  return Object.fromEntries(columns.map((column) => [column, 'This value is already in use.']));
}

/** 404 for any route that did not match. */
export function notFoundMiddleware(req, res) {
  res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: `No route matches ${req.method} ${req.path}.` },
  });
}

/**
 * The single place an error becomes an HTTP response.
 *
 * Known failures produce a specific code and message. Unknown failures produce
 * a 500 carrying only a reference id; the stack is logged server-side under
 * that same id, so we can trace it without leaking internals to the client.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity.
export function errorMiddleware(error, req, res, next) {
  if (error instanceof AppError) {
    const body = { code: error.code, message: error.message };
    if (error.fields) body.fields = error.fields;
    return res.status(error.status).json({ error: body });
  }

  switch (error?.code) {
    case PRISMA_UNIQUE_VIOLATION: {
      const fields = fieldsFromUniqueTarget(error);
      return res.status(409).json({
        error: {
          code: 'DUPLICATE',
          message: 'A record with these details already exists.',
          ...(fields ? { fields } : {}),
        },
      });
    }
    case PRISMA_RECORD_NOT_FOUND:
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', message: 'That record no longer exists.' } });
    case PRISMA_FOREIGN_KEY_VIOLATION:
      return res.status(409).json({
        error: {
          code: 'IN_USE',
          message: 'This record is referenced by other records and cannot be changed.',
        },
      });
    case PRISMA_WRITE_CONFLICT:
      return res.status(409).json({
        error: {
          code: 'CONCURRENT_UPDATE',
          message: 'Someone else changed this record. Reload the page and try again.',
        },
      });
    default:
      break;
  }

  const requestId = randomUUID().slice(0, 8);
  console.error(`[${requestId}] Unhandled error on ${req.method} ${req.path}`);
  console.error(error);

  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: `Unexpected server error (reference ${requestId}).`,
      requestId,
    },
  });
}
