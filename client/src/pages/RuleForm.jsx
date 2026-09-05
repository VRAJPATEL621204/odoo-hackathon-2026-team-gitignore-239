import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useAuth, PERMISSIONS } from '../auth/AuthProvider.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Button } from '../components/Button.jsx';
import { Checkbox, SelectInput, TextArea, TextInput } from '../components/Field.jsx';
import { ErrorState, Notice } from '../components/Feedback.jsx';
import {
  COMPUTATIONS,
  PERCENTAGE_BASES,
  RULE_CATEGORIES,
  useStructures,
} from '../hooks/usePayrollOptions.js';

/**
 * One salary rule.
 *
 * The three computation methods are mutually exclusive, so only the fields
 * belonging to the chosen one are shown; the server clears the others, which is
 * why switching from a percentage to a fixed amount cannot leave a stale
 * percentage behind.
 */

const EMPTY = {
  structureId: '',
  name: '',
  code: '',
  category: 'ALLOWANCE',
  sequence: 10,
  computation: 'FIXED',
  amount: '',
  percentage: '',
  percentageBase: 'CONTRACT_WAGE',
  formula: '',
  quantity: 1,
  active: true,
  notes: '',
};

/** The values a formula may read, shown next to the field rather than hidden. */
const FORMULA_HELP = [
  ['wage', 'the contract wage for the period'],
  ['worked_days / total_days', 'days paid, and working days in the period'],
  ['unpaid_days / leave_days', 'unpaid leave, and all approved leave'],
  ['overtime_hours', 'overtime recorded in attendance'],
  ['worked_ratio', 'worked_days ÷ total_days'],
  ["categories['BASIC']", 'the running total of a category'],
  ["rules['HRA']", 'the amount an earlier rule produced'],
  ['min, max, round, abs, floor, ceil', 'the functions available'],
];

export function RuleForm() {
  const { id } = useParams();
  const isNew = id === 'new';
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const { structures } = useStructures();

  const editable = can(PERMISSIONS.PAYROLL_CONFIGURE);

  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formulaCheck, setFormulaCheck] = useState(null);

  const record = useResource(
    (signal) => (isNew ? Promise.resolve(null) : api.get(`/payroll/rules/${id}`, { signal })),
    [id]
  );

  useEffect(() => {
    if (isNew) {
      setForm({ ...EMPTY, structureId: params.get('structureId') ?? '' });
      return;
    }
    if (!record.data) return;

    const rule = record.data;
    setForm({
      structureId: String(rule.structure.id),
      name: rule.name,
      code: rule.code,
      category: rule.category,
      sequence: rule.sequence,
      computation: rule.computation,
      amount: rule.amount ?? '',
      percentage: rule.percentage ?? '',
      percentageBase: rule.percentageBase ?? 'CONTRACT_WAGE',
      formula: rule.formula ?? '',
      quantity: rule.quantity ?? 1,
      active: rule.active,
      notes: rule.notes ?? '',
    });
  }, [record.data, isNew, params]);

  const set = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  /** Checks the expression on the server, using the same parser payroll uses. */
  async function checkFormula() {
    try {
      const result = await api.post('/payroll/rules/validate-formula', { formula: form.formula });
      setFormulaCheck(result);
    } catch {
      setFormulaCheck({ valid: false, message: 'Could not check the formula.' });
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    const body = {
      structureId: Number(form.structureId),
      name: form.name,
      code: form.code,
      category: form.category,
      sequence: Number(form.sequence),
      computation: form.computation,
      amount: form.computation === 'FIXED' ? Number(form.amount) : null,
      percentage: form.computation === 'PERCENTAGE' ? Number(form.percentage) : null,
      percentageBase: form.computation === 'PERCENTAGE' ? form.percentageBase : null,
      formula: form.computation === 'FORMULA' ? form.formula : null,
      quantity: Number(form.quantity) || 1,
      active: form.active,
      notes: form.notes.trim() === '' ? null : form.notes.trim(),
    };

    try {
      const saved = isNew
        ? await api.post('/payroll/rules', body)
        : await api.patch(`/payroll/rules/${id}`, body);

      toast.success(isNew ? 'Salary rule created.' : 'Salary rule saved.');
      if (isNew) navigate(`/payroll/rules/${saved.id}`, { replace: true });
      else record.refetch();
    } catch (error) {
      if (error?.fields) setFieldErrors(error.fields);
      else setFormError(error?.message ?? 'Could not save the rule.');
    } finally {
      setSaving(false);
    }
  }

  if (record.error) return <ErrorState error={record.error} onRetry={record.refetch} />;

  return (
    <div className="stack">
      <PageHeader
        title={isNew ? 'New Salary Rule' : (record.data?.name ?? 'Salary Rule')}
        subtitle="One line of the salary calculation."
        actions={
          <Link to={form.structureId ? `/payroll/structures/${form.structureId}` : '/payroll/rules'}>
            ← Back
          </Link>
        }
      />

      <form className="stack" onSubmit={onSubmit} noValidate>
        {formError && <Notice tone="error">{formError}</Notice>}

        <div className="card stack">
          <div className="grid grid--2">
            <TextInput
              label="Rule Name"
              required
              value={form.name}
              error={fieldErrors.name}
              disabled={!editable}
              onChange={set('name')}
            />

            <SelectInput
              label="Salary Structure"
              required
              placeholder="Select structure"
              value={form.structureId}
              error={fieldErrors.structureId}
              disabled={!editable}
              options={structures.map((structure) => ({
                value: String(structure.id),
                label: structure.name,
              }))}
              onChange={set('structureId')}
            />

            <TextInput
              label="Code"
              required
              hint="What a formula refers to, such as BASIC. Stored in capitals."
              value={form.code}
              error={fieldErrors.code}
              disabled={!editable}
              onChange={set('code')}
            />

            <SelectInput
              label="Category"
              required
              hint="Gross is basic plus allowances; net is gross plus deductions."
              value={form.category}
              error={fieldErrors.category}
              disabled={!editable}
              options={RULE_CATEGORIES}
              onChange={set('category')}
            />

            <TextInput
              label="Sequence"
              type="number"
              min="1"
              required
              hint="Rules run from lowest to highest. A rule can only read the ones before it."
              value={form.sequence}
              error={fieldErrors.sequence}
              disabled={!editable}
              onChange={set('sequence')}
            />

            <TextInput
              label="Quantity"
              type="number"
              min="0"
              step="0.5"
              hint="Multiplies whatever the computation produced."
              value={form.quantity}
              error={fieldErrors.quantity}
              disabled={!editable}
              onChange={set('quantity')}
            />
          </div>
        </div>

        <div className="card stack">
          <h2>Computation</h2>

          <SelectInput
            label="Method"
            required
            value={form.computation}
            error={fieldErrors.computation}
            disabled={!editable}
            options={COMPUTATIONS}
            onChange={set('computation')}
          />

          {form.computation === 'FIXED' && (
            <TextInput
              label="Fixed Amount"
              type="number"
              step="0.01"
              required
              hint="The exact value, such as a meal allowance of 2,000."
              value={form.amount}
              error={fieldErrors.amount}
              disabled={!editable}
              onChange={set('amount')}
            />
          )}

          {form.computation === 'PERCENTAGE' && (
            <div className="grid grid--2">
              <TextInput
                label="Percentage"
                type="number"
                step="0.01"
                required
                hint="50 means 50%, not 0.5."
                value={form.percentage}
                error={fieldErrors.percentage}
                disabled={!editable}
                onChange={set('percentage')}
              />
              <SelectInput
                label="Percentage of"
                required
                value={form.percentageBase}
                error={fieldErrors.percentageBase}
                disabled={!editable}
                options={PERCENTAGE_BASES}
                onChange={set('percentageBase')}
              />
            </div>
          )}

          {form.computation === 'FORMULA' && (
            <div className="stack">
              <TextArea
                label="Formula"
                rows={3}
                required
                hint="Arithmetic over the values below. Written as an expression, never executed as code."
                value={form.formula}
                error={fieldErrors.formula}
                disabled={!editable}
                onChange={(event) => {
                  setFormulaCheck(null);
                  set('formula')(event);
                }}
              />

              <div className="row">
                <Button size="small" onClick={checkFormula} disabled={!form.formula}>
                  Check formula
                </Button>
                {formulaCheck && (
                  <span className={formulaCheck.valid ? 'muted' : 'field__error'}>
                    {formulaCheck.valid ? 'This formula parses.' : formulaCheck.message}
                  </span>
                )}
              </div>

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Available in a formula</th>
                      <th>Meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FORMULA_HELP.map(([name, meaning]) => (
                      <tr key={name}>
                        <td>
                          <code className="mono">{name}</code>
                        </td>
                        <td className="muted">{meaning}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="muted">
                Example: <code className="mono">result = categories['BASIC'] * worked_days / total_days</code>
              </p>
            </div>
          )}
        </div>

        <div className="card stack">
          <TextArea
            label="Notes"
            rows={2}
            value={form.notes}
            error={fieldErrors.notes}
            disabled={!editable}
            onChange={set('notes')}
          />

          <Checkbox
            label="Active — included when a payslip is computed"
            checked={form.active}
            disabled={!editable}
            onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
          />
        </div>

        {editable && (
          <div className="row">
            <Button type="submit" variant="primary" pending={saving}>
              {isNew ? 'Create Rule' : 'Save'}
            </Button>
            <Button onClick={() => navigate('/payroll/rules')}>Cancel</Button>
          </div>
        )}
      </form>
    </div>
  );
}
