import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useDebounced } from '../hooks/useDebounced.js';
import { useOptions, toSelectOptions } from '../hooks/useOptions.js';
import { useAuth, PERMISSIONS } from '../auth/AuthProvider.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Button } from '../components/Button.jsx';
import { DataTable, Pagination } from '../components/DataTable.jsx';
import { Notice, StatusBadge } from '../components/Feedback.jsx';
import { formatDate, formatMoney, statusTone, titleCase } from '../lib/format.js';

/**
 * Contracts, optionally filtered to one employee.
 *
 * The employee filter lives in the query string, which is what makes the
 * Contracts smart button on the employee form a plain link.
 */
export function Contracts() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const options = useOptions();

  const employeeId = params.get('employeeId') ?? '';
  const [search, setSearch] = useState('');
  const applied = useDebounced(search);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => setPage(1), [applied, status, employeeId]);

  const list = useResource(
    (signal) =>
      api.get('/contracts', {
        signal,
        query: { search: applied, status, employeeId, page, pageSize: 10 },
      }),
    [applied, status, employeeId, page]
  );

  const focused = options.employees.find((person) => String(person.id) === employeeId);

  const columns = [
    { key: 'reference', header: 'Contract' },
    { key: 'employee', header: 'Employee', render: (row) => row.employee.name },
    { key: 'startDate', header: 'Start', render: (row) => formatDate(row.startDate) },
    { key: 'endDate', header: 'End', render: (row) => (row.endDate ? formatDate(row.endDate) : '—') },
    {
      key: 'wage',
      header: 'Wage / Month',
      numeric: true,
      render: (row) => formatMoney(row.wage),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StatusBadge tone={statusTone(row.status)}>{titleCase(row.status)}</StatusBadge>
      ),
    },
  ];

  return (
    <div className="stack">
      <PageHeader
        title="Contracts"
        subtitle="Employment history. Payroll uses the contract covering the payslip period."
        actions={
          can(PERMISSIONS.EMPLOYEES_WRITE) && (
            <Button
              variant="primary"
              onClick={() =>
                navigate(employeeId ? `/contracts/new?employeeId=${employeeId}` : '/contracts/new')
              }
            >
              + New
            </Button>
          )
        }
      />

      {focused && (
        <Notice tone="info">
          Showing contracts for <strong>{focused.name}</strong> only.{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              params.delete('employeeId');
              setParams(params, { replace: true });
            }}
          >
            Show all contracts
          </button>
        </Notice>
      )}

      <div className="card stack">
        <div className="row">
          <input
            className="input"
            style={{ flex: 1, minWidth: 200 }}
            aria-label="Search contracts"
            placeholder="Search by reference or employee…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <select
            className="select"
            style={{ maxWidth: 190 }}
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
            style={{ maxWidth: 150 }}
            aria-label="Filter by status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="RUNNING">Running</option>
            <option value="EXPIRED">Expired</option>
          </select>
        </div>

        <DataTable
          columns={columns}
          rows={list.data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.refetch}
          onRowClick={(row) => navigate(`/contracts/${row.id}`)}
          emptyTitle="No contracts match"
          emptyDescription="Clear the filters, or create a contract for an employee."
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
