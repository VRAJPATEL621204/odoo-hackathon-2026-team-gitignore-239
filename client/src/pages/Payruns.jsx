import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useDebounced } from '../hooks/useDebounced.js';
import { useAuth, PERMISSIONS } from '../auth/AuthProvider.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Button } from '../components/Button.jsx';
import { DataTable, Pagination } from '../components/DataTable.jsx';
import { StatusBadge } from '../components/Feedback.jsx';
import { formatDate, formatMoney } from '../lib/format.js';
import { payrollStatusLabel, payrollStatusTone } from '../hooks/usePayrollOptions.js';
import { NewPayrunWizard } from './NewPayrunWizard.jsx';

/**
 * Payruns: one per payroll period, grouping the payslips it produced.
 *
 * The warning count is on the list because it is what decides whether a payrun
 * can be validated, and somebody scanning the list needs to see which period
 * still needs attention.
 */
export function Payruns() {
  const navigate = useNavigate();
  const { can } = useAuth();

  const [search, setSearch] = useState('');
  const applied = useDebounced(search);
  const [status, setStatus] = useState('');
  const [year, setYear] = useState('');
  const [page, setPage] = useState(1);
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => setPage(1), [applied, status, year]);

  const list = useResource(
    (signal) =>
      api.get('/payroll/payruns', {
        signal,
        query: { search: applied, status, year, page, pageSize: 10 },
      }),
    [applied, status, year, page]
  );

  const currentYear = new Date().getFullYear();
  const years = [currentYear + 1, currentYear, currentYear - 1, currentYear - 2];

  const columns = [
    { key: 'name', header: 'Payrun' },
    {
      key: 'period',
      header: 'Period',
      render: (row) => `${formatDate(row.periodStart)} — ${formatDate(row.periodEnd)}`,
    },
    { key: 'structure', header: 'Structure', render: (row) => row.structure.name },
    { key: 'payslipCount', header: 'Payslips', numeric: true },
    {
      key: 'netTotal',
      header: 'Net Total',
      numeric: true,
      render: (row) => formatMoney(row.netTotal),
    },
    {
      key: 'warningCount',
      header: 'Warnings',
      render: (row) =>
        row.warningCount > 0 ? (
          <StatusBadge tone="warning">{row.warningCount}</StatusBadge>
        ) : (
          <span className="muted">None</span>
        ),
    },
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
        title="Payruns"
        subtitle="Payroll processing for a period: compute, validate, mark paid, send."
        actions={
          can(PERMISSIONS.PAYROLL_PROCESS) && (
            <Button variant="primary" onClick={() => setWizardOpen(true)}>
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
            aria-label="Search payruns"
            placeholder="Search payruns…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <select
            className="select"
            style={{ maxWidth: 140 }}
            aria-label="Filter by year"
            value={year}
            onChange={(event) => setYear(event.target.value)}
          >
            <option value="">All years</option>
            {years.map((option) => (
              <option key={option} value={option}>
                {option}
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
            <option value="COMPUTED">Computed</option>
            <option value="VALIDATED">Validated</option>
            <option value="PAID">Paid</option>
          </select>
        </div>

        <DataTable
          columns={columns}
          rows={list.data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.refetch}
          onRowClick={(row) => navigate(`/payroll/payruns/${row.id}`)}
          emptyTitle="No payruns yet"
          emptyDescription="Create one for a period and choose the employees it covers."
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

      <NewPayrunWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={(payrun) => {
          setWizardOpen(false);
          navigate(`/payroll/payruns/${payrun.id}`);
        }}
      />
    </div>
  );
}
