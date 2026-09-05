const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * Reads `page` and `pageSize` from the query string.
 *
 * `pageSize` is capped so a caller cannot ask for the entire table and turn a
 * list endpoint into a full-table scan.
 */
export function parsePageParams(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const requested = Number.parseInt(query.pageSize, 10) || DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, requested));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/** The shape every paginated list endpoint returns. */
export function pageResult(items, total, { page, pageSize }) {
  return { items, total, page, pageSize };
}

/**
 * Trims a free-text search term, returning null when there is nothing to
 * search for.
 *
 * `%` and `_` are LIKE wildcards, and Prisma's `contains` passes them straight
 * through: searching for "%" would match every row and "_" would match any
 * single character. Somebody typing those means the characters themselves, so
 * they are escaped. The backslash goes first, or it would escape the escapes.
 */
export function parseSearch(query) {
  const term = typeof query.search === 'string' ? query.search.trim() : '';
  if (term.length === 0) return null;

  return term
    .slice(0, 100)
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
}
