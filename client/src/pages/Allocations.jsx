import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useDebounced } from '../hooks/useDebounced.js';
import { useOptions, toSelectOptions } from '../hooks/useOptions.js';
import { useTimeOffTypes, unitLabel } from '../hooks/useTimeOffTypes.js';
import { useAuth, PERMISSIONS } from '../auth/AuthProvider.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Button } from '../components/Button.jsx';
import { DataTable, Pagination } from '../components/DataTable.jsx';
import { StatusBadge } from '../components/Feedback.jsx';
import { timeOffStatusLabel, timeOffStatusTone } from '../lib/timeoff.js';

/**
 * Allocations, with the balance arithmetic on show.
 *
 * Allocated, taken and remaining are the point of the list: an approved
 * allocation is what creates balance, and the three figures together say how
 * much of it is still there.
 */
export function Allocations() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const options = useOptions();
  const { types } = useTimeOffTypes();

  const employeeId = params.get('employeeId') ?? '';
  const [search, setSearch] = useState('');
  const applied = useDebounced(search);
  const [status, setStatus] = useState('');
  const [typeId, setTypeId] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => setPage(1), [applied, status, typeId, employeeId]);

  const list = useResource(
    (signal) =>
      api.get('/time-off/allocations', {
        signal,
        query: { search: applied, status, typeId, employeeId, page, pageSize: 12 },
      }),
    [applied, status, typeId, employeeId, page]
  );

  const columns = [
    { key: 'employee', header: 'Employee', render: (row) => row.employee.name },
    { key: 'type', header: 'Type', render: (row) => row.type.name },
    {
      key: 'allocated',
      header: 'Allocated',
      numeric: true,
      render: (row) => `${row.allocated} ${unitLabel(row.type.unit)}`,
    },
    { key: 'taken', header: 'Taken', numeric: true },
    {
      key: 'pending',
      header: 'Pending',
      numeric: true,
      render: (row) => (row.pending > 0 ? row.pending : '—'),
    },
    { key: 'remaining', header: 'Remaining', numeric: true },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StatusBadge tone={timeOffStatusTone(row.status)}>
          {timeOffStatusLabel(row.status)}
        </StatusBadge>
      ),
    },
  ];

  return (
    <div className="stack">
      <PageHeader
        title="Allocations"
        subtitle="Only an approved allocation creates leave balance."
        actions={
          can(PERMISSIONS.TIMEOFF_CONFIGURE) && (
            <Button variant="primary" onClick={() => navigate('/time-off/allocations/new')}>
              + New
            </Button>
          )
        }
      />

      <div className="card stack">
        <div className="row">
          <input
            className="input"
            style={{ flex: 1, minWidth: 180 }}
            aria-label="Search allocations by employee"
            placeholder="Search by employee…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <select
            className="select"
            style={{ maxWidth: 180 }}
            aria-label="Filter by employee"
            value={employeeId}
            onChange={(event) => {
              if (event.target.value) params.set('employeeId', event.target.value);
              else params.delete('employeeId');
              setParams(params, { replace: true });
            }}
          >
            <option value="">All employees</option>
            {toSelectOptions(options.employees).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            className="select"
            style={{ maxWidth: 170 }}
            aria-label="Filter by type"
            value={typeId}
            onChange={(event) => setTypeId(event.target.value)}
          >
            <option value="">All types</option>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>

          <select
            className="select"
            style={{ maxWidth: 150 }}
            aria-label="Filter by status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            <option value="TO_APPROVE">To Approve</option>
            <option value="APPROVED">Approved</option>
            <option value="REFUSED">Refused</option>
          </select>
        </div>

        <DataTable
          columns={columns}
          rows={list.data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.refetch}
          onRowClick={(row) => navigate(`/time-off/allocations/${row.id}`)}
          emptyTitle="No allocations match"
          emptyDescription="Grant an employee a balance so they can take that kind of leave."
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
