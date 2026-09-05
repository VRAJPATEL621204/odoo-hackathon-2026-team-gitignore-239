import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useDebounced } from '../hooks/useDebounced.js';
import { useOptions } from '../hooks/useOptions.js';
import { useAuth, PERMISSIONS } from '../auth/AuthProvider.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Button } from '../components/Button.jsx';
import { DataTable, Pagination } from '../components/DataTable.jsx';
import { StatusBadge } from '../components/Feedback.jsx';
import { formatHours } from '../lib/format.js';

/**
 * Working schedules, list view.
 *
 * Days and hours per week are shown as the API computed them from the weekly
 * pattern; nothing on this screen is typed in by hand.
 */
export function Schedules() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { company } = useOptions();

  const [search, setSearch] = useState('');
  const applied = useDebounced(search);
  const [page, setPage] = useState(1);

  useEffect(() => setPage(1), [applied]);

  const list = useResource(
    (signal) => api.get('/schedules', { signal, query: { search: applied, page, pageSize: 10 } }),
    [applied, page]
  );

  const columns = [
    { key: 'name', header: 'Schedule Name' },
    { key: 'daysPerWeek', header: 'Days / Week', numeric: true },
    {
      key: 'hoursPerWeek',
      header: 'Hours / Week',
      numeric: true,
      render: (row) => formatHours(row.hoursPerWeek),
    },
    { key: 'company', header: 'Company', render: () => company || '—' },
    {
      key: 'active',
      header: 'Status',
      render: (row) => (
        <StatusBadge tone={row.active ? 'success' : 'danger'}>
          {row.active ? 'Active' : 'Inactive'}
        </StatusBadge>
      ),
    },
  ];

  return (
    <div className="stack">
      <PageHeader
        title="Working Schedules"
        subtitle="Weekly working patterns used by attendance and payroll."
        actions={
          can(PERMISSIONS.EMPLOYEES_WRITE) && (
            <Button variant="primary" onClick={() => navigate('/schedules/new')}>
              + New Schedule
            </Button>
          )
        }
      />

      <div className="card stack">
        <input
          className="input"
          aria-label="Search schedules"
          placeholder="Search schedules…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <DataTable
          columns={columns}
          rows={list.data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.refetch}
          onRowClick={(row) => navigate(`/schedules/${row.id}`)}
          emptyTitle="No working schedules"
          emptyDescription="Create the weekly pattern employees are expected to work."
        />

        {list.data && (
          <Pagination
            page={list.data.page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            onPageChange={setPage}
          />
        )}
      </div>
    </div>
  );
}
