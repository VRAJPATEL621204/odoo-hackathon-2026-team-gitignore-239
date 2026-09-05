import { useEffect, useState } from 'react';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useDebounced } from '../hooks/useDebounced.js';
import { useOptions, toSelectOptions } from '../hooks/useOptions.js';
import { useAuth, PERMISSIONS } from '../auth/AuthProvider.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Button } from '../components/Button.jsx';
import { DataTable, Pagination } from '../components/DataTable.jsx';
import { Checkbox, SelectInput, TextArea, TextInput } from '../components/Field.jsx';
import { Notice, StatusBadge } from '../components/Feedback.jsx';

/** Job positions: the roles employees and contracts are hired into. */

const EMPTY = { name: '', departmentId: '', description: '', active: true };

export function JobPositions() {
  const toast = useToast();
  const { can } = useAuth();
  const options = useOptions();

  const [search, setSearch] = useState('');
  const applied = useDebounced(search);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => setPage(1), [applied]);

  const list = useResource(
    (signal) => api.get('/job-positions', { signal, query: { search: applied, page, pageSize: 10 } }),
    [applied, page]
  );

  const editable = can(PERMISSIONS.EMPLOYEES_WRITE);
  const editing = selectedId !== null;

  function select(row) {
    setSelectedId(row.id);
    setFieldErrors({});
    setFormError(null);
    setForm({
      name: row.name,
      departmentId: row.department ? String(row.department.id) : '',
      description: row.description ?? '',
      active: row.active,
    });
  }

  function startNew() {
    setSelectedId(null);
    setFieldErrors({});
    setFormError(null);
    setForm(EMPTY);
  }

  async function onSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    const body = {
      name: form.name,
      departmentId: form.departmentId ? Number(form.departmentId) : null,
      description: form.description,
      active: form.active,
    };

    try {
      if (editing) {
        await api.patch(`/job-positions/${selectedId}`, body);
        toast.success('Job position saved.');
      } else {
        await api.post('/job-positions', body);
        toast.success('Job position created.');
        startNew();
      }
      list.refetch();
      options.refetch();
    } catch (error) {
      if (error?.fields) setFieldErrors(error.fields);
      else setFormError(error?.message ?? 'Could not save the job position.');
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: 'name', header: 'Job Position' },
    { key: 'department', header: 'Department', render: (row) => row.department?.name ?? '—' },
    { key: 'employeeCount', header: 'Employees', numeric: true },
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
        title="Job Positions"
        subtitle="Roles an employee is hired into. Only active positions appear in pickers."
      />

      <div className="split">
        <div className="card stack">
          <div className="row">
            {editable && (
              <Button variant="primary" onClick={startNew}>
                + New
              </Button>
            )}
            <input
              className="input"
              style={{ flex: 1, minWidth: 180 }}
              aria-label="Search job positions"
              placeholder="Search job positions…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <DataTable
            columns={columns}
            rows={list.data?.items}
            loading={list.loading}
            error={list.error}
            onRetry={list.refetch}
            onRowClick={editable ? select : undefined}
            emptyTitle="No job positions"
            emptyDescription="Create the roles people are hired into."
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

        {editable && (
          <form className="card stack" onSubmit={onSubmit} noValidate>
            <h2>{editing ? 'Edit Job Position' : 'New Job Position'}</h2>

            {formError && <Notice tone="error">{formError}</Notice>}

            <TextInput
              label="Name"
              required
              value={form.name}
              error={fieldErrors.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />

            <SelectInput
              label="Department"
              placeholder="No department"
              value={form.departmentId}
              error={fieldErrors.departmentId}
              options={toSelectOptions(options.departments)}
              onChange={(event) =>
                setForm((current) => ({ ...current, departmentId: event.target.value }))
              }
            />

            <TextArea
              label="Description"
              rows={3}
              value={form.description}
              error={fieldErrors.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
            />

            <Checkbox
              label="Active — offered in the employee and contract pickers"
              checked={form.active}
              onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
            />

            <div className="row">
              <Button type="submit" variant="primary" pending={saving}>
                {editing ? 'Save' : 'Create'}
              </Button>
              {editing && <Button onClick={startNew}>Cancel</Button>}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
