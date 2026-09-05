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

/**
 * Salary structures: the calculations payslips are produced by.
 *
 * A structure groups salary rules, and the payrun that names it determines
 * which set of rules computes every payslip in it.
 */
export function SalaryStructures() {
  const navigate = useNavigate();
  const { can } = useAuth();

  const [search, setSearch] = useState('');
  const applied = useDebounced(search);
  const [page, setPage] = useState(1);

  useEffect(() => setPage(1), [applied]);

  const list = useResource(
    (signal) =>
      api.get('/payroll/structures', { signal, query: { search: applied, page, pageSize: 10 } }),
    [applied, page]
  );

  const columns = [
    { key: 'name', header: 'Structure Name' },
    { key: 'ruleCount', header: 'Rules', numeric: true },
    { key: 'payslipCount', header: 'Payslips', numeric: true },
    {
      key: 'active',
      header: 'Status',
      render: (row) => (
        <StatusBadge tone={row.active ? 'success' : 'default'}>
          {row.active ? 'Active' : 'Archived'}
        </StatusBadge>
      ),
    },
  ];

  return (
    <div className="stack">
      <PageHeader
        title="Salary Structures"
        subtitle="Each structure is an ordered set of rules that computes a payslip."
        actions={
          can(PERMISSIONS.PAYROLL_CONFIGURE) && (
            <Button variant="primary" onClick={() => navigate('/payroll/structures/new')}>
              + New
            </Button>
          )
        }
      />

      <div className="card stack">
        <input
          className="input"
          aria-label="Search salary structures"
          placeholder="Search structures…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <DataTable
          columns={columns}
          rows={list.data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.refetch}
          onRowClick={(row) => navigate(`/payroll/structures/${row.id}`)}
          emptyTitle="No salary structures"
          emptyDescription="Create a structure, then add the rules that compute a payslip."
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
