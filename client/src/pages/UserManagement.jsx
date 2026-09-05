import { useEffect, useMemo, useState } from 'react';

import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useResource } from '../hooks/useResource.js';
import { useToast } from '../components/ToastProvider.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Button } from '../components/Button.jsx';
import { DataTable, Pagination } from '../components/DataTable.jsx';
import { Checkbox, SelectInput, TextInput } from '../components/Field.jsx';
import { Notice, StatusBadge } from '../components/Feedback.jsx';

/**
 * Administrator screen for user accounts.
 *
 * The list and the form sit side by side, as in the reference flow: selecting a
 * row loads it into the form, and "New User" clears the form for a new one.
 * Everything here is gated behind users.manage on both sides of the wire.
 */

const EMPTY_FORM = { employeeId: '', email: '', roles: [], active: true, password: '' };

export function UserManagement() {
  const toast = useToast();
  const { user: currentUser } = useAuth();

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  // Debounced so a search does not fire a request per keystroke.
  const [appliedSearch, setAppliedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const roles = useResource((signal) => api.get('/auth/roles', { signal }), []);

  const users = useResource(
    (signal) =>
      api.get('/users', {
        signal,
        query: { search: appliedSearch, role: roleFilter, page, pageSize: 10 },
      }),
    [appliedSearch, roleFilter, page]
  );

  const employees = useResource((signal) => api.get('/users/assignable-employees', { signal }), []);

  const roleOptions = roles.data?.items ?? [];
  const roleLabels = useMemo(
    () => Object.fromEntries(roleOptions.map((role) => [role.value, role.label])),
    [roleOptions]
  );

  const editing = selectedId !== null;
  const editingSelf = editing && selectedId === currentUser?.id;

  function selectUser(row) {
    setSelectedId(row.id);
    setFieldErrors({});
    setFormError(null);
    setForm({
      employeeId: String(row.employee.id),
      email: row.email,
      roles: row.roles,
      active: row.active,
      password: '',
    });
  }

  function startNew() {
    setSelectedId(null);
    setFieldErrors({});
    setFormError(null);
    setForm(EMPTY_FORM);
  }

  function toggleRole(value) {
    setForm((current) => ({
      ...current,
      roles: current.roles.includes(value)
        ? current.roles.filter((role) => role !== value)
        : [...current.roles, value],
    }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    try {
      if (editing) {
        // The employee link is fixed after creation, and a blank password means
        // "leave it as it is" rather than "clear it".
        const body = { email: form.email };
        if (form.password) body.password = form.password;
        if (!editingSelf) {
          body.roles = form.roles;
          body.active = form.active;
        }
        await api.patch(`/users/${selectedId}`, body);
        toast.success('Access saved.');
      } else {
        await api.post('/users', {
          employeeId: Number(form.employeeId),
          email: form.email,
          roles: form.roles,
          active: form.active,
          password: form.password,
        });
        toast.success('User created.');
        startNew();
      }
      users.refetch();
      employees.refetch();
    } catch (error) {
      if (error?.fields) setFieldErrors(error.fields);
      setFormError(error?.fields ? null : (error?.message ?? 'Could not save the user.'));
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: 'user', header: 'User', render: (row) => row.employee.name },
    { key: 'position', header: 'Job Position', render: (row) => row.employee.jobTitle ?? '—' },
    { key: 'email', header: 'Work Email', render: (row) => row.email },
    {
      key: 'roles',
      header: 'Role',
      render: (row) => row.roles.map((role) => roleLabels[role] ?? role).join(', '),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StatusBadge tone={row.active ? 'success' : 'danger'}>
          {row.active ? 'Active' : 'Inactive'}
        </StatusBadge>
      ),
    },
  ];

  const employeeOptions = (employees.data?.items ?? []).map((employee) => ({
    value: String(employee.id),
    label: `${employee.name}${employee.jobTitle ? ` — ${employee.jobTitle}` : ''}`,
  }));

  return (
    <div className="stack">
      <PageHeader
        title="User Management"
        subtitle="Accounts are linked to an employee and given one or more roles."
        actions={<StatusBadge tone="info">Admin only</StatusBadge>}
      />

      <div className="split">
        <div className="card stack">
          <div className="row">
            <Button variant="primary" onClick={startNew}>
              + New User
            </Button>
            <input
              className="input"
              style={{ flex: 1, minWidth: 200 }}
              aria-label="Search users"
              placeholder="Search users, employees or email…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              className="select"
              style={{ maxWidth: 190 }}
              aria-label="Filter by role"
              value={roleFilter}
              onChange={(event) => {
                setRoleFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All roles</option>
              {roleOptions.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </div>

          <DataTable
            columns={columns}
            rows={users.data?.items}
            loading={users.loading}
            error={users.error}
            onRetry={users.refetch}
            onRowClick={selectUser}
            emptyTitle="No user accounts match"
            emptyDescription="Clear the search, or create an account for an employee."
          />

          {users.data && (
            <Pagination
              page={users.data.page}
              pageSize={users.data.pageSize}
              total={users.data.total}
              onPageChange={setPage}
            />
          )}
        </div>

        <form className="card stack" onSubmit={onSubmit} noValidate>
          <h2>{editing ? 'Edit User' : 'Create User'}</h2>

          {formError && <Notice tone="error">{formError}</Notice>}

          {editingSelf && (
            <Notice tone="warning">
              This is your own account. Roles and status can only be changed by another
              administrator, so you cannot widen your own access.
            </Notice>
          )}

          <SelectInput
            label="Employee"
            required
            placeholder={editing ? undefined : 'Select employee'}
            value={form.employeeId}
            error={fieldErrors.employeeId}
            disabled={editing}
            hint={
              editing
                ? 'The linked employee cannot be changed after the account is created.'
                : 'Only employees without an account are listed.'
            }
            options={
              editing
                ? [{ value: form.employeeId, label: selectedEmployeeLabel(users.data, selectedId) }]
                : employeeOptions
            }
            onChange={(event) => {
              const employeeId = event.target.value;
              const match = (employees.data?.items ?? []).find(
                (employee) => String(employee.id) === employeeId
              );
              // Prefilling the login address from the employee's work email is
              // what the reference flow does, and it stays editable.
              setForm((current) => ({
                ...current,
                employeeId,
                email: current.email || (match?.workEmail ?? ''),
              }));
            }}
          />

          <TextInput
            label="Work Email"
            type="email"
            required
            placeholder="employee@company.com"
            value={form.email}
            error={fieldErrors.email}
            onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
          />

          <TextInput
            label={editing ? 'New password' : 'Temporary password'}
            type="password"
            required={!editing}
            value={form.password}
            error={fieldErrors.password}
            hint={
              editing
                ? 'Leave blank to keep the current password.'
                : 'At least 8 characters. Share it with the employee.'
            }
            onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
          />

          <div className="field">
            <span className="field__label">
              Roles<span aria-hidden="true"> *</span>
            </span>
            <div className="stack stack--tight">
              {roleOptions.map((role) => (
                <Checkbox
                  key={role.value}
                  label={`${role.label} — ${role.description}`}
                  checked={form.roles.includes(role.value)}
                  disabled={editingSelf}
                  onChange={() => toggleRole(role.value)}
                />
              ))}
            </div>
            {fieldErrors.roles && <span className="field__error">{fieldErrors.roles}</span>}
          </div>

          <div className="row">
            <span className="field__label" style={{ minWidth: 110 }}>
              Account Status
            </span>
            <Button
              size="small"
              variant={form.active ? 'primary' : 'danger'}
              disabled={editingSelf}
              onClick={() => setForm((current) => ({ ...current, active: !current.active }))}
            >
              {form.active ? 'Active' : 'Inactive'}
            </Button>
          </div>

          <div className="row">
            <Button type="submit" variant="primary" pending={saving}>
              {editing ? 'Save Access' : 'Create User'}
            </Button>
            {editing && <Button onClick={startNew}>Cancel</Button>}
          </div>
        </form>
      </div>
    </div>
  );
}

/** Label for the locked employee select while editing an existing account. */
function selectedEmployeeLabel(pageData, userId) {
  const row = (pageData?.items ?? []).find((item) => item.id === userId);
  if (!row) return '—';
  return `${row.employee.name}${row.employee.jobTitle ? ` — ${row.employee.jobTitle}` : ''}`;
}
