import { Button } from './Button.jsx';

/** Coloured status pill. `tone` is one of default, success, warning, danger, info. */
export function StatusBadge({ children, tone = 'default' }) {
  return <span className={`badge${tone === 'default' ? '' : ` badge--${tone}`}`}>{children}</span>;
}

export function Notice({ children, tone = 'info' }) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      {children}
    </div>
  );
}

/**
 * Empty states name the reason the list is empty and what to do next, rather
 * than showing a blank table.
 */
export function EmptyState({ title, description, action }) {
  return (
    <div className="empty-state">
      <div className="empty-state__title">{title}</div>
      {description && <div>{description}</div>}
      {action && <div style={{ marginTop: 'var(--space-4)' }}>{action}</div>}
    </div>
  );
}

/**
 * Renders an ApiError. The server's message is shown verbatim because it is
 * written to be read by the user; only the retry affordance is added here.
 */
export function ErrorState({ error, onRetry }) {
  const reference = error?.code === 'INTERNAL' ? error?.message : null;
  return (
    <div className="stack">
      <Notice tone="error">
        <strong>Could not load this page.</strong>
        <div>{reference ?? error?.message ?? 'Unknown error.'}</div>
      </Notice>
      {onRetry && (
        <div>
          <Button onClick={onRetry}>Try again</Button>
        </div>
      )}
    </div>
  );
}

/** Placeholder rows sized to the real table so nothing shifts when data lands. */
export function SkeletonRows({ rows = 5, columns = 4 }) {
  return (
    <tbody>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <tr key={rowIndex}>
          {Array.from({ length: columns }, (_, columnIndex) => (
            <td key={columnIndex}>
              <div className="skeleton" style={{ width: columnIndex === 0 ? '60%' : '40%' }} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}
