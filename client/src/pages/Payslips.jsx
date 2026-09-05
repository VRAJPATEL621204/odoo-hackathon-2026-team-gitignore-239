import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useDebounced } from '../hooks/useDebounced.js';
import { useOptions, toSelectOptions } from '../hooks/useOptions.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { DataTable, Pagination } from '../components/DataTable.jsx';
import { Notice, StatusBadge } from '../components/Feedback.jsx';
import { formatDate, formatMoney } from '../lib/format.js';
import { payrollStatusLabel, payrollStatusTone } from '../hooks/usePayrollOptions.js';

/** Every payslip across payruns, filterable by employee, status and period. */
export function Payslips() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const options = useOptions();

  const employeeId = params.get('employeeId') ?? '';
  const [search, setSearch] = useState('');
  const applied = useDebounced(search);
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => setPage(1), [applied, status, employeeId, from, to]);

  const list = useResource(
    (signal) =>
      api.get('/payroll/payslips', {
        signal,
        query: { search: applied, status, employeeId, from, to, page, pageSize: 15 },
      }),
    [applied, status, employeeId, from, to, page]
  );

  const focused = options.employees.find((person) => String(person.id) === employeeId);

  const columns = [
    { key: 'reference', header: 'Reference' },
    { key: 'employee', header: 'Employee', render: (row) => row.employee.name },
    {
      key: 'warnings',
      header: 'Warning',
      render: (row) =>
        row.warnings.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          <StatusBadge tone="warning">{row.warnings.length}</StatusBadge>
        ),
    },
    {
      key: 'period',
      header: 'Period',
      render: (row) => `${formatDate(row.periodStart)} — ${formatDate(row.periodEnd)}`,
    },
    { key: 'basic', header: 'Basic', numeric: true, render: (row) => formatMoney(row.basic) },
    { key: 'gross', header: 'Gross', numeric: true, render: (row) => formatMoney(row.gross) },
    { key: 'net', header: 'Net', numeric: true, render: (row) => formatMoney(row.net) },
    { key: 'structure', header: 'Structure', render: (row) => row.structure.name },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StatusBadge tone={payrollStatusTone(row.status)}>
          {payrollStatusLabel(row.status)}
        </StatusBadge>
      ),
    },
  ];

  return (
    <div className="stack">
      <PageHeader
        title="Payslips"
        subtitle="Every payslip, with the salary computation behind it."
      />

      {focused && (
        <Notice tone="info">
          Showing payslips for <strong>{focused.name}</strong> only.{' '}
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
            aria-label="Search payslips"
            placeholder="Search by reference or employee…"
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
            style={{ maxWidth: 140 }}
            aria-label="Filter by status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="DONE">Done</option>
            <option value="PAID">Paid</option>
          </select>
        </div>

        <div className="row">
          <label className="row" style={{ gap: 'var(--space-2)' }}>
            <span className="muted">Period from</span>
            <input
              className="input"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="row" style={{ gap: 'var(--space-2)' }}>
            <span className="muted">to</span>
            <input
              className="input"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          {(from || to) && (
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setFrom('');
                setTo('');
              }}
            >
              Clear dates
            </button>
          )}
        </div>

        <DataTable
          columns={columns}
          rows={list.data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.refetch}
          onRowClick={(row) => navigate(`/payroll/payslips/${row.id}`)}
          emptyTitle="No payslips match"
          emptyDescription="Clear the filters, or create a payrun for a period."
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
