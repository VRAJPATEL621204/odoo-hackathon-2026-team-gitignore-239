import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useDebounced } from '../hooks/useDebounced.js';
import { useOptions, toSelectOptions } from '../hooks/useOptions.js';
import { useAuth, PERMISSIONS } from '../auth/AuthProvider.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Button } from '../components/Button.jsx';
import { DataTable, Pagination } from '../components/DataTable.jsx';
import { EmptyState, ErrorState, StatusBadge } from '../components/Feedback.jsx';
import { initials, statusTone, titleCase } from '../lib/format.js';

/**
 * The employee master, in the two views the problem statement asks for.
 *
 * Kanban is for browsing and list is for scanning, but both open the same
 * record, and the chosen view is remembered so it survives a round trip
 * through an employee form.
 */

const VIEW_STORAGE_KEY = 'peoplepay360.employees.view';

function readStoredView() {
  // Storage throws in a private window or when site data is blocked, and a
  // remembered view is not worth failing the page over.
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'kanban';
  } catch {
    return 'kanban';
  }
}

function EmployeeCard({ employee, onOpen }) {
  return (
    <button type="button" className="kanban-card" onClick={onOpen}>
      <div className="kanban-card__head">
        <span className="avatar avatar--large">{initials(employee.name)}</span>
        <div>
          <div className="kanban-card__name">{employee.name}</div>
          <div className="muted">{employee.jobTitle ?? 'No job position'}</div>
        </div>
      </div>
      <div className="kanban-card__foot">
        <span className="muted">{employee.department?.name ?? 'No department'}</span>
        <StatusBadge tone={statusTone(employee.status)}>{titleCase(employee.status)}</StatusBadge>
      </div>
    </button>
  );
}

export function Employees() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const options = useOptions();

  const [view, setView] = useState(readStoredView);
  const [search, setSearch] = useState('');
  const applied = useDebounced(search);
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  // The view is in this list because kanban and list show different numbers of
  // records: staying on page 3 of a ten-per-page list lands on an empty page
  // once the twelve-per-page kanban has fewer pages.
  useEffect(() => setPage(1), [applied, departmentId, status, view]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // Nothing to do: the view simply will not be remembered.
    }
  }, [view]);

  const list = useResource(
    (signal) =>
      api.get('/employees', {
        signal,
        query: { search: applied, departmentId, status, page, pageSize: view === 'kanban' ? 12 : 10 },
      }),
    [applied, departmentId, status, page, view]
  );

  const columns = [
    { key: 'name', header: 'Employee' },
    { key: 'workEmail', header: 'Work Email' },
    { key: 'jobTitle', header: 'Job Position', render: (row) => row.jobTitle ?? '—' },
    { key: 'department', header: 'Department', render: (row) => row.department?.name ?? '—' },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StatusBadge tone={statusTone(row.status)}>{titleCase(row.status)}</StatusBadge>
      ),
    },
  ];

  const rows = list.data?.items ?? [];

  return (
    <div className="stack">
      <PageHeader
        title="Employees"
        subtitle="Everyone employed by the company, with their HR record."
        actions={
          can(PERMISSIONS.EMPLOYEES_WRITE) && (
            <Button variant="primary" onClick={() => navigate('/employees/new')}>
              + New
            </Button>
          )
        }
      />

      <div className="card stack">
        <div className="row">
          <input
            className="input"
            style={{ flex: 1, minWidth: 200 }}
            aria-label="Search employees"
            placeholder="Search employees…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <select
            className="select"
            style={{ maxWidth: 180 }}
            aria-label="Filter by department"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <option value="">All departments</option>
            {toSelectOptions(options.departments).map((option) => (
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
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>

          <div className="segmented" role="group" aria-label="View">
            <button
              type="button"
              className={`segmented__option${view === 'kanban' ? ' is-active' : ''}`}
              onClick={() => setView('kanban')}
            >
              Kanban
            </button>
            <button
              type="button"
              className={`segmented__option${view === 'list' ? ' is-active' : ''}`}
              onClick={() => setView('list')}
            >
              List
            </button>
          </div>
        </div>

        {view === 'list' ? (
          <DataTable
            columns={columns}
            rows={rows}
            loading={list.loading}
            error={list.error}
            onRetry={list.refetch}
            onRowClick={(row) => navigate(`/employees/${row.id}`)}
            emptyTitle="No employees match"
            emptyDescription="Clear the filters, or add the first employee."
          />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={list.refetch} />
        ) : list.loading ? (
          <div className="kanban">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="kanban-card">
                <div className="skeleton" style={{ height: 42 }} />
                <div className="skeleton" style={{ width: '60%' }} />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No employees match"
            description="Clear the filters, or add the first employee."
          />
        ) : (
          <div className="kanban">
            {rows.map((employee) => (
              <EmployeeCard
                key={employee.id}
                employee={employee}
                onOpen={() => navigate(`/employees/${employee.id}`)}
              />
            ))}
          </div>
        )}

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
