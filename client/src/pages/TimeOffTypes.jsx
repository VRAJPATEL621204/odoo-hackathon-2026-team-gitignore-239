import { useEffect, useState } from 'react';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useDebounced } from '../hooks/useDebounced.js';
import { useAuth, PERMISSIONS } from '../auth/AuthProvider.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Button } from '../components/Button.jsx';
import { DataTable, Pagination } from '../components/DataTable.jsx';
import { Checkbox, SelectInput, TextArea, TextInput } from '../components/Field.jsx';
import { Notice, StatusBadge } from '../components/Feedback.jsx';

/**
 * Time off types: the policy behind every request.
 *
 * The type decides the behaviour — whether a request has to draw on an
 * allocation, who approves it, and what payroll records — so this screen is
 * where leave policy is configured rather than where leave is taken.
 */

const EMPTY = {
  name: '',
  unit: 'DAYS',
  requiresAllocation: true,
  approvedBy: 'MANAGER',
  workEntry: '',
  color: '',
  description: '',
  active: true,
};

export function TimeOffTypes() {
  const toast = useToast();
  const { can } = useAuth();

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
    (signal) =>
      api.get('/time-off/types', { signal, query: { search: applied, page, pageSize: 10 } }),
    [applied, page]
  );

  const editable = can(PERMISSIONS.TIMEOFF_CONFIGURE);
  const editing = selectedId !== null;

  function select(row) {
    setSelectedId(row.id);
    setFieldErrors({});
    setFormError(null);
    setForm({
      name: row.name,
      unit: row.unit,
      requiresAllocation: row.requiresAllocation,
      approvedBy: row.approvedBy,
      workEntry: row.workEntry ?? '',
      color: row.color ?? '',
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
      ...form,
      workEntry: form.workEntry.trim() === '' ? null : form.workEntry.trim(),
      color: form.color.trim() === '' ? null : form.color.trim(),
      description: form.description.trim() === '' ? null : form.description.trim(),
    };

    try {
      if (editing) {
        await api.patch(`/time-off/types/${selectedId}`, body);
        toast.success('Time off type saved.');
      } else {
        await api.post('/time-off/types', body);
        toast.success('Time off type created.');
        startNew();
      }
      list.refetch();
    } catch (error) {
      if (error?.fields) setFieldErrors(error.fields);
      else setFormError(error?.message ?? 'Could not save the time off type.');
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: 'name', header: 'Type' },
    { key: 'unit', header: 'Unit', render: (row) => (row.unit === 'HOURS' ? 'Hours' : 'Days') },
    {
      key: 'requiresAllocation',
      header: 'Allocation',
      render: (row) => (row.requiresAllocation ? 'Required' : 'No'),
    },
    {
      key: 'approvedBy',
      header: 'Approval',
      render: (row) => (row.approvedBy === 'OFFICER' ? 'Officer' : 'Manager'),
    },
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
        title="Time Off Types"
        subtitle="Policy, not transactions: what each kind of leave requires and who approves it."
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
              aria-label="Search time off types"
              placeholder="Search time off types…"
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
            onRowClick={select}
            emptyTitle="No time off types"
            emptyDescription="Create the kinds of leave employees can request."
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

        <form className="card stack" onSubmit={onSubmit} noValidate>
          <h2>{editing ? 'Edit Time Off Type' : 'New Time Off Type'}</h2>

          {formError && <Notice tone="error">{formError}</Notice>}

          <TextInput
            label="Type Name"
            required
            value={form.name}
            error={fieldErrors.name}
            disabled={!editable}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />

          <SelectInput
            label="Unit"
            required
            value={form.unit}
            error={fieldErrors.unit}
            disabled={!editable}
            hint="Days counts working days; Hours counts the hours the schedule expects."
            options={[
              { value: 'DAYS', label: 'Days' },
              { value: 'HOURS', label: 'Hours' },
            ]}
            onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))}
          />

          <SelectInput
            label="Approval"
            required
            value={form.approvedBy}
            error={fieldErrors.approvedBy}
            disabled={!editable}
            options={[
              { value: 'MANAGER', label: 'Manager' },
              { value: 'OFFICER', label: 'Time Off Officer' },
            ]}
            onChange={(event) =>
              setForm((current) => ({ ...current, approvedBy: event.target.value }))
            }
          />

          <TextInput
            label="Payroll / Work Entry"
            hint="What payroll records for these days, such as Leave Work Entry."
            value={form.workEntry}
            error={fieldErrors.workEntry}
            disabled={!editable}
            onChange={(event) =>
              setForm((current) => ({ ...current, workEntry: event.target.value }))
            }
          />

          <TextInput
            label="Display Colour"
            value={form.color}
            error={fieldErrors.color}
            disabled={!editable}
            onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))}
          />

          <TextArea
            label="Configuration notes"
            rows={3}
            value={form.description}
            error={fieldErrors.description}
            disabled={!editable}
            onChange={(event) =>
              setForm((current) => ({ ...current, description: event.target.value }))
            }
          />

          <Checkbox
            label="Requires an approved allocation before leave can be approved"
            checked={form.requiresAllocation}
            disabled={!editable}
            onChange={(event) =>
              setForm((current) => ({ ...current, requiresAllocation: event.target.checked }))
            }
          />

          <Checkbox
            label="Active — offered when requesting time off"
            checked={form.active}
            disabled={!editable}
            onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
          />

          {editable && (
            <div className="row">
              <Button type="submit" variant="primary" pending={saving}>
                {editing ? 'Save' : 'Create'}
              </Button>
              {editing && <Button onClick={startNew}>Cancel</Button>}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
