import { useEffect, useState } from 'react';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useOptions, toSelectOptions } from '../hooks/useOptions.js';
import { useAuth, PERMISSIONS } from '../auth/AuthProvider.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Button } from '../components/Button.jsx';
import { DataTable, Pagination } from '../components/DataTable.jsx';
import { SelectInput, TextInput } from '../components/Field.jsx';
import { Notice } from '../components/Feedback.jsx';
import { useDebounced } from '../hooks/useDebounced.js';

/**
 * Departments: the list on the left, the record being edited on the right.
 *
 * A department is three fields, so a separate form page would be more
 * navigation than the record deserves.
 */

const EMPTY = { name: '', managerId: '' };

export function Departments() {
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

  // A new search starts at the first page; staying on page 3 of the old result
  // would show an empty table.
  useEffect(() => setPage(1), [applied]);

  const list = useResource(
    (signal) => api.get('/departments', { signal, query: { search: applied, page, pageSize: 10 } }),
    [applied, page]
  );

  const editable = can(PERMISSIONS.EMPLOYEES_WRITE);
  const editing = selectedId !== null;

  function select(row) {
    setSelectedId(row.id);
    setFieldErrors({});
    setFormError(null);
    setForm({ name: row.name, managerId: row.manager ? String(row.manager.id) : '' });
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

    // An empty picker means "no manager", which the API reads as an explicit null.
    const body = { name: form.name, managerId: form.managerId ? Number(form.managerId) : null };

    try {
      if (editing) {
        await api.patch(`/departments/${selectedId}`, body);
        toast.success('Department saved.');
      } else {
        await api.post('/departments', body);
        toast.success('Department created.');
        startNew();
      }
      list.refetch();
      options.refetch();
    } catch (error) {
      if (error?.fields) setFieldErrors(error.fields);
      else setFormError(error?.message ?? 'Could not save the department.');
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: 'name', header: 'Department' },
    { key: 'manager', header: 'Manager', render: (row) => row.manager?.name ?? '—' },
    { key: 'employeeCount', header: 'Employees', numeric: true },
  ];

  return (
    <div className="stack">
      <PageHeader title="Departments" subtitle="Units employees and contracts belong to." />

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
              aria-label="Search departments"
              placeholder="Search departments…"
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
            emptyTitle="No departments"
            emptyDescription="Create the first department to group employees."
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
            <h2>{editing ? 'Edit Department' : 'New Department'}</h2>

            {formError && <Notice tone="error">{formError}</Notice>}

            <TextInput
              label="Department Name"
              required
              value={form.name}
              error={fieldErrors.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />

            <SelectInput
              label="Manager"
              placeholder="No manager"
              value={form.managerId}
              error={fieldErrors.managerId}
              options={toSelectOptions(options.employees)}
              onChange={(event) =>
                setForm((current) => ({ ...current, managerId: event.target.value }))
              }
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
