import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useDebounced } from '../hooks/useDebounced.js';
import { useAuth, PERMISSIONS } from '../auth/AuthProvider.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Button } from '../components/Button.jsx';
import { DataTable, Pagination } from '../components/DataTable.jsx';
import { StatusBadge } from '../components/Feedback.jsx';
import {
  RULE_CATEGORIES,
  categoryLabel,
  computationLabel,
  useStructures,
} from '../hooks/usePayrollOptions.js';

/** Every salary rule across the structures, searchable by name or code. */
export function SalaryRules() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const { structures } = useStructures();

  const structureId = params.get('structureId') ?? '';
  const [search, setSearch] = useState('');
  const applied = useDebounced(search);
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => setPage(1), [applied, category, structureId]);

  const list = useResource(
    (signal) =>
      api.get('/payroll/rules', {
        signal,
        query: { search: applied, category, structureId, page, pageSize: 15 },
      }),
    [applied, category, structureId, page]
  );

  const columns = [
    { key: 'name', header: 'Rule Name' },
    { key: 'code', header: 'Code', render: (row) => <code className="mono">{row.code}</code> },
    { key: 'category', header: 'Category', render: (row) => categoryLabel(row.category) },
    { key: 'structure', header: 'Structure', render: (row) => row.structure.name },
    { key: 'sequence', header: 'Sequence', numeric: true },
    {
      key: 'computation',
      header: 'Computation',
      render: (row) => computationLabel(row.computation),
    },
    {
      key: 'active',
      header: '',
      render: (row) => (row.active ? null : <StatusBadge>Inactive</StatusBadge>),
    },
  ];

  return (
    <div className="stack">
      <PageHeader
        title="Salary Rules"
        subtitle="Fixed amounts, percentages and formulas — the lines every payslip is made of."
        actions={
          can(PERMISSIONS.PAYROLL_CONFIGURE) && (
            <Button
              variant="primary"
              onClick={() =>
                navigate(structureId ? `/payroll/rules/new?structureId=${structureId}` : '/payroll/rules/new')
              }
            >
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
            aria-label="Search salary rules"
            placeholder="Search by name or code…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <select
            className="select"
            style={{ maxWidth: 190 }}
            aria-label="Filter by structure"
            value={structureId}
            onChange={(event) => {
              if (event.target.value) params.set('structureId', event.target.value);
              else params.delete('structureId');
              setParams(params, { replace: true });
            }}
          >
            <option value="">All structures</option>
            {structures.map((structure) => (
              <option key={structure.id} value={structure.id}>
                {structure.name}
              </option>
            ))}
          </select>

          <select
            className="select"
            style={{ maxWidth: 160 }}
            aria-label="Filter by category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">All categories</option>
            {RULE_CATEGORIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <DataTable
          columns={columns}
          rows={list.data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.refetch}
          onRowClick={(row) => navigate(`/payroll/rules/${row.id}`)}
          emptyTitle="No salary rules match"
          emptyDescription="Clear the filters, or add a rule to a structure."
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
