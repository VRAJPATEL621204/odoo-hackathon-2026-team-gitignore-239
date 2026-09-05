import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { Button } from '../components/Button.jsx';
import { ErrorState, Notice, StatusBadge } from '../components/Feedback.jsx';

/**
 * Reports whether the browser can reach the API and whether the API can reach
 * PostgreSQL. This is the first place to look when the stack misbehaves
 * locally, and it proves the React → Vite proxy → Express → Prisma path works.
 */
export function SystemStatus() {
  const { data, loading, error, refetch } = useResource((signal) => api.get('/health', { signal }));

  return (
    <div className="stack">
      <PageHeader
        title="System status"
        subtitle="Live check of the API and the database connection."
        actions={
          <Button onClick={refetch} pending={loading}>
            Re-check
          </Button>
        }
      />

      {error && <ErrorState error={error} onRetry={refetch} />}

      {!error && (
        <div className="card stack">
          <div className="row">
            <strong style={{ minWidth: 140 }}>API</strong>
            {loading ? (
              <div className="skeleton" style={{ width: 90 }} />
            ) : (
              <StatusBadge tone="success">reachable</StatusBadge>
            )}
          </div>

          <div className="row">
            <strong style={{ minWidth: 140 }}>Database</strong>
            {loading ? (
              <div className="skeleton" style={{ width: 90 }} />
            ) : (
              <StatusBadge tone={data?.db === 'connected' ? 'success' : 'danger'}>
                {data?.db ?? 'unknown'}
              </StatusBadge>
            )}
          </div>

          <div className="row">
            <strong style={{ minWidth: 140 }}>Company</strong>
            {loading ? (
              <div className="skeleton" style={{ width: 140 }} />
            ) : (
              <span>{data?.company ?? '—'}</span>
            )}
          </div>
        </div>
      )}

      <Notice tone="info">
        If the database shows as unavailable, run <code className="mono">docker compose up -d</code>{' '}
        from the repository root and wait for the container to report healthy.
      </Notice>
    </div>
  );
}
