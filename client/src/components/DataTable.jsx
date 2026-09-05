import { EmptyState, ErrorState, SkeletonRows } from './Feedback.jsx';
import { Button } from './Button.jsx';

/**
 * The one table used by every list screen.
 *
 * It owns the four states a list can be in — loading, error, empty and loaded —
 * so no page has to reimplement them and none of them can be forgotten.
 *
 * `columns` is `[{ key, header, numeric?, render(row) }]`.
 */
export function DataTable({
  columns,
  rows,
  loading = false,
  error = null,
  onRetry,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyAction,
  onRowClick,
  rowKey = (row) => row.id,
}) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;

  const showEmpty = !loading && (!rows || rows.length === 0);

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.numeric ? 'table__cell--numeric' : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>

        {loading && <SkeletonRows rows={6} columns={columns.length} />}

        {!loading && !showEmpty && (
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: 'pointer' } : undefined}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={column.numeric ? 'table__cell--numeric' : undefined}
                  >
                    {column.render ? column.render(row) : (row[column.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        )}

        {showEmpty && (
          <tbody>
            <tr>
              <td colSpan={columns.length}>
                <EmptyState
                  title={emptyTitle}
                  description={emptyDescription}
                  action={emptyAction}
                />
              </td>
            </tr>
          </tbody>
        )}
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="pagination">
      <span className="muted">
        {total === 0 ? 'No records' : `${first}–${last} of ${total}`}
      </span>
      <div className="row">
        <Button size="small" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <span className="muted">
          Page {page} of {totalPages}
        </span>
        <Button size="small" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
