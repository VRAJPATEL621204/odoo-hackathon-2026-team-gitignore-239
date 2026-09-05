import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useAuth, PERMISSIONS } from '../auth/AuthProvider.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Button } from '../components/Button.jsx';
import { Checkbox, TextArea, TextInput } from '../components/Field.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { ErrorState, Notice, StatusBadge } from '../components/Feedback.jsx';
import { formatMoney } from '../lib/format.js';
import { categoryLabel, computationLabel } from '../hooks/usePayrollOptions.js';

/**
 * One salary structure, with the rules it runs.
 *
 * The rules are listed in sequence order because that order is the
 * calculation: HRA can be a percentage of basic only because basic ran first.
 * The sequence column is on screen for exactly that reason.
 */
export function StructureForm() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();

  const editable = can(PERMISSIONS.PAYROLL_CONFIGURE);

  const [form, setForm] = useState({ name: '', notes: '', active: true });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const record = useResource(
    (signal) => (isNew ? Promise.resolve(null) : api.get(`/payroll/structures/${id}`, { signal })),
    [id]
  );

  useEffect(() => {
    if (!record.data) return;
    setForm({
      name: record.data.name,
      notes: record.data.notes ?? '',
      active: record.data.active,
    });
  }, [record.data]);

  async function onSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    const body = { ...form, notes: form.notes.trim() === '' ? null : form.notes.trim() };

    try {
      const saved = isNew
        ? await api.post('/payroll/structures', body)
        : await api.patch(`/payroll/structures/${id}`, body);

      toast.success(isNew ? 'Structure created.' : 'Structure saved.');
      if (isNew) navigate(`/payroll/structures/${saved.id}`, { replace: true });
      else record.refetch();
    } catch (error) {
      if (error?.fields) setFieldErrors(error.fields);
      else setFormError(error?.message ?? 'Could not save the structure.');
    } finally {
      setSaving(false);
    }
  }

  if (record.error) return <ErrorState error={record.error} onRetry={record.refetch} />;

  const structure = record.data;

  /** What a rule computes, said in one line without opening it. */
  function computationSummary(rule) {
    switch (rule.computation) {
      case 'FIXED':
        return formatMoney(rule.amount);
      case 'PERCENTAGE':
        return `${rule.percentage}% of ${categoryLabel(rule.percentageBase ?? 'CONTRACT_WAGE').toLowerCase()}`;
      case 'FORMULA':
        return <code className="mono">{rule.formula}</code>;
      default:
        return '—';
    }
  }

  const ruleColumns = [
    { key: 'sequence', header: 'Seq', numeric: true },
    { key: 'name', header: 'Rule Name' },
    { key: 'code', header: 'Code', render: (row) => <code className="mono">{row.code}</code> },
    { key: 'category', header: 'Category', render: (row) => categoryLabel(row.category) },
    {
      key: 'computation',
      header: 'Computation',
      render: (row) => (
        <span>
          <span className="muted">{computationLabel(row.computation)}</span>
          <br />
          {computationSummary(row)}
        </span>
      ),
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
        title={isNew ? 'New Salary Structure' : (structure?.name ?? 'Salary Structure')}
        subtitle="The rules below run in sequence order to produce a payslip."
        actions={<Link to="/payroll/structures">← Back to list</Link>}
      />

      <form className="stack" onSubmit={onSubmit} noValidate>
        {formError && <Notice tone="error">{formError}</Notice>}

        <div className="card stack">
          <div className="grid grid--2">
            <TextInput
              label="Structure Name"
              required
              value={form.name}
              error={fieldErrors.name}
              disabled={!editable}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
            <div className="field">
              <span className="field__label">Active</span>
              <Checkbox
                label="Offered when creating a payrun"
                checked={form.active}
                disabled={!editable}
                onChange={(event) =>
                  setForm((current) => ({ ...current, active: event.target.checked }))
                }
              />
            </div>
          </div>

          <TextArea
            label="Notes"
            rows={2}
            value={form.notes}
            error={fieldErrors.notes}
            disabled={!editable}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
          />

          {editable && (
            <div className="row">
              <Button type="submit" variant="primary" pending={saving}>
                {isNew ? 'Create Structure' : 'Save'}
              </Button>
              <Button onClick={() => navigate('/payroll/structures')}>Cancel</Button>
            </div>
          )}
        </div>
      </form>

      {!isNew && (
        <div className="card stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Salary Rules</h2>
            {editable && (
              <Button size="small" onClick={() => navigate(`/payroll/rules/new?structureId=${id}`)}>
                + Add Rule
              </Button>
            )}
          </div>

          <DataTable
            columns={ruleColumns}
            rows={structure?.rules}
            loading={record.loading}
            onRowClick={(row) => navigate(`/payroll/rules/${row.id}`)}
            emptyTitle="No rules yet"
            emptyDescription="A structure with no rules computes a payslip of zeroes."
          />

          <p className="muted">
            Rules run from the lowest sequence to the highest, and each one can read what the rules
            before it produced. Changing the order changes the calculation.
          </p>
        </div>
      )}
    </div>
  );
}
