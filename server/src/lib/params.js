import { notFound } from './errors.js';

/**
 * Reads a numeric route parameter.
 *
 * `Number("abc")` is NaN, and passing that to Prisma throws a driver error that
 * surfaces as a 500 with a reference id — a mistyped or stale URL reported as a
 * server fault, and logged as one. A non-numeric id cannot match a record, so
 * it is a 404 like any other record that is not there.
 */
export function readId(value, what = 'Record') {
  // Digits only. `Number` would also accept "1e3", " 12 " and "0x10", none of
  // which anybody meant to type as a record id, and all of which would quietly
  // fetch a different record than the URL appears to name.
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw notFound(what);

  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw notFound(what);
  return id;
}
