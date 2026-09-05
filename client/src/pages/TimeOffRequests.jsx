import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useDebounced } from '../hooks/useDebounced.js';
import { useOptions, toSelectOptions } from '../hooks/useOptions.js';
import { useTimeOffTypes, unitLabel } from '../hooks/useTimeOffTypes.js';
import { useAuth, PERMISSIONS } from '../auth/AuthProvider.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Button } from '../components/Button.jsx';
import { DataTable, Pagination } from '../components/DataTable.jsx';
import { Notice, StatusBadge } from '../components/Feedback.jsx';
import { formatDate } from '../lib/format.js';
import { timeOffStatusLabel, timeOffStatusTone } from '../lib/timeoff.js';

/**
 * Time off requests, with the approval decision available from the list.
 *
 * Approving one at a time from its own page would make a morning of requests a
 * morning of navigation, so Approve and Refuse are on the row. "My Team" is
 * resolved from the session on the server, so it always means the signed-in
 * user's own reports.
 */
export function TimeOffRequests() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const { can } = useAuth();
  const options = useOptions();
  const { types } = useTimeOffTypes();

  const employeeId = params.get('employeeId') ?? '';
  const [search, setSearch] = useState('');
  const applied = useDebounced(search);
  const [status, setStatus] = useState('');
  const [typeId, setTypeId] = useState('');
  const [myTeam, setMyTeam] = useState(false);
  const [page, setPage] = useState(1);
  const [deciding, setDeciding] = useState(null);

  useEffect(() => setPage(1), [applied, status, typeId, employeeId, myTeam]);

  const list = useResource(
    (signal) =>
      api.get('/time-off/requests', {
        signal,
        query: {
          search: applied,
          status,
          typeId,
          employeeId,
          myTeam: myTeam ? 'true' : '',
          page,
          pageSize: 12,
        },
      }),
    [applied, status, typeId, employeeId, myTeam, page]
  );

  const mayApprove = can(PERMISSIONS.TIMEOFF_APPROVE);
  const focused = options.employees.find((person) => String(person.id) === employeeId);

  async function decide(row, next) {
    setDeciding(`${row.id}:${next}`);
    try {
      await api.post(`/time-off/requests/${row.id}/status`, { status: next });
      toast.success(next === 'APPROVED' ? 'Request approved.' : 'Request refused.');
      list.refetch();
    } catch (error) {
      // The balance and overlap rules are enforced on approval, so this is
      // where the user finds out a request cannot be granted.
      toast.error(error?.message ?? 'Could not change the request.');
    } finally {
      setDeciding(null);
    }
  }

  const columns = [
    { key: 'employee', header: 'Employee', render: (row) => row.employee.name },
    { key: 'type', header: 'Type', render: (row) => row.type.name },
    { key: 'startDate', header: 'Start', render: (row) => formatDate(row.startDate) },
    { key: 'endDate', header: 'End', render: (row) => formatDate(row.endDate) },
    {
      key: 'duration',
      header: 'Duration',
      numeric: true,
      render: (row) => `${row.duration} ${unitLabel(row.type.unit)}`,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StatusBadge tone={timeOffStatusTone(row.status)}>
          {timeOffStatusLabel(row.status)}
        </StatusBadge>
      ),
    },
    ...(mayApprove
      ? [
          {
            key: 'actions',
            header: '',
            render: (row) => (
              <span
                className="row"
                style={{ gap: 'var(--space-2)', flexWrap: 'nowrap' }}
                // The row itself opens the record; the buttons decide on it.
                onClick={(event) => event.stopPropagation()}
              >
                {row.status !== 'APPROVED' && (
                  <Button
                    size="small"
                    variant="primary"
                    pending={deciding === `${row.id}:APPROVED`}
                    onClick={() => decide(row, 'APPROVED')}
                  >
                    Approve
                  </Button>
                )}
                {row.status !== 'REFUSED' && (
                  <Button
                    size="small"
                    variant="danger"
                    pending={deciding === `${row.id}:REFUSED`}
                    onClick={() => decide(row, 'REFUSED')}
                  >
                    Refuse
                  </Button>
                )}
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="stack">
      <PageHeader
        title="Time Off Requests"
        subtitle="Requests and the approval they are waiting on."
        actions={
          <Button variant="primary" onClick={() => navigate('/time-off/requests/new')}>
            + New
          </Button>
        }
      />

      {focused && (
        <Notice tone="info">
          Showing requests for <strong>{focused.name}</strong> only.{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              params.delete('employeeId');
              setParams(params, { replace: true });
            }}
          >
            Show everybody
          </button>
        </Notice>
      )}

      <div className="card stack">
        <div className="row">
          <input
            className="input"
            style={{ flex: 1, minWidth: 180 }}
            aria-label="Search requests by employee"
            placeholder="Search by employee…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <Button
            size="small"
            variant={myTeam ? 'primary' : 'default'}
            onClick={() => setMyTeam((current) => !current)}
          >
            My Team
          </Button>

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
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>

        <DataTable
          columns={columns}
          rows={list.data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.refetch}
          onRowClick={(row) => navigate(`/time-off/requests/${row.id}`)}
          emptyTitle="No requests match"
          emptyDescription={
            myTeam
              ? 'Nobody reporting to you has time off in this state.'
              : 'Clear the filters, or create a request.'
          }
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
