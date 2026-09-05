import { useEffect, useMemo, useState } from 'react';

import { api } from '../api/client.js';
import { useToast } from '../components/ToastProvider.jsx';
import { Modal } from '../components/Modal.jsx';
import { Button } from '../components/Button.jsx';
import { SelectInput, TextInput } from '../components/Field.jsx';
import { Notice, StatusBadge } from '../components/Feedback.jsx';
import { formatDate, formatHours, formatMoney } from '../lib/format.js';
import { useStructures } from '../hooks/usePayrollOptions.js';

/**
 * Creating a payrun, in the two steps the reference flow specifies.
 *
 * The first step collects the scope only — structure and period — and creates
 * nothing. The payrun comes into existence with the second step, because a
 * payrun is the employees in it: continuing from the first step and abandoning
 * the second would otherwise leave an empty payrun behind.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** First and last day of the month containing today, as date-input values. */
function defaultPeriod() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const pad = (value) => String(value).padStart(2, '0');
  const lastDay = new Date(year, month + 1, 0).getDate();

  return {
    periodStart: `${year}-${pad(month + 1)}-01`,
    periodEnd: `${year}-${pad(month + 1)}-${pad(lastDay)}`,
  };
}

/** "September 2026" from a period start, so the name need not be typed. */
function nameForPeriod(periodStart) {
  if (!periodStart) return '';
  const [year, month] = periodStart.split('-').map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

export function NewPayrunWizard({ open, onClose, onCreated }) {
  const toast = useToast();
  const { structures } = useStructures();

  const [step, setStep] = useState('scope');
  const [scope, setScope] = useState({ structureId: '', name: '', ...defaultPeriod() });
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState('');
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  // Reopening the wizard starts a new payrun, not the abandoned one.
  useEffect(() => {
    if (!open) return;
    setStep('scope');
    setScope({ structureId: '', name: '', ...defaultPeriod() });
    setSelected(new Set());
    setSearch('');
    setEmployees([]);
    setError(null);
    setFieldErrors({});
  }, [open]);

  const nameSuggestion = nameForPeriod(scope.periodStart);

  async function onContinue() {
    setFieldErrors({});
    setError(null);

    const problems = {};
    if (!scope.structureId) problems.structureId = 'Choose the structure to compute with.';
    if (!scope.periodStart) problems.periodStart = 'Enter the start of the period.';
    if (!scope.periodEnd) problems.periodEnd = 'Enter the end of the period.';
    if (scope.periodStart && scope.periodEnd && scope.periodEnd < scope.periodStart) {
      problems.periodEnd = 'The period cannot end before it starts.';
    }
    if (Object.keys(problems).length > 0) {
      setFieldErrors(problems);
      return;
    }

    setLoading(true);
    try {
      const result = await api.get('/payroll/eligible-employees', {
        query: { periodStart: scope.periodStart, periodEnd: scope.periodEnd },
      });
      setEmployees(result.items);
      // Everybody eligible starts selected, which is the common case; taking
      // somebody out is quicker than ticking everybody in.
      setSelected(new Set(result.items.map((employee) => employee.id)));
      setStep('employees');
    } catch (requestError) {
      setError(requestError?.message ?? 'Could not load the eligible employees.');
    } finally {
      setLoading(false);
    }
  }

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return employees;
    return employees.filter((employee) => employee.name.toLowerCase().includes(term));
  }, [employees, search]);

  function toggle(id) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function create() {
    setCreating(true);
    setError(null);

    try {
      const payrun = await api.post('/payroll/payruns', {
        name: scope.name.trim() === '' ? nameSuggestion : scope.name.trim(),
        structureId: Number(scope.structureId),
        periodStart: scope.periodStart,
        periodEnd: scope.periodEnd,
        employeeIds: [...selected],
      });

      toast.success(`${payrun.name} created with ${payrun.payslipCount} payslip(s).`);
      onCreated(payrun);
    } catch (requestError) {
      if (requestError?.fields) setFieldErrors(requestError.fields);
      else setError(requestError?.message ?? 'Could not create the payrun.');
    } finally {
      setCreating(false);
    }
  }

  const scopeFooter = (
    <>
      <Button variant="primary" pending={loading} onClick={onContinue}>
        Continue
      </Button>
      <Button onClick={onClose}>Discard</Button>
    </>
  );

  const employeesFooter = (
    <>
      <Button variant="primary" pending={creating} disabled={selected.size === 0} onClick={create}>
        Create Payrun ({selected.size})
      </Button>
      <Button onClick={() => setStep('scope')}>Back</Button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={step === 'employees' ? 780 : 520}
      title={step === 'scope' ? 'New Pay Run' : 'Select Employee Records'}
      footer={step === 'scope' ? scopeFooter : employeesFooter}
    >
      {error && <Notice tone="error">{error}</Notice>}

      {step === 'scope' ? (
        <div className="stack">
          <SelectInput
            label="Pay Structure"
            required
            placeholder="Select structure"
            value={scope.structureId}
            error={fieldErrors.structureId}
            options={structures.map((structure) => ({
              value: String(structure.id),
              label: structure.name,
            }))}
            onChange={(event) =>
              setScope((current) => ({ ...current, structureId: event.target.value }))
            }
          />

          <div className="grid grid--2">
            <TextInput
              label="Period Start"
              type="date"
              required
              value={scope.periodStart}
              error={fieldErrors.periodStart}
              onChange={(event) =>
                setScope((current) => ({ ...current, periodStart: event.target.value }))
              }
            />
            <TextInput
              label="Period End"
              type="date"
              required
              value={scope.periodEnd}
              error={fieldErrors.periodEnd}
              onChange={(event) =>
                setScope((current) => ({ ...current, periodEnd: event.target.value }))
              }
            />
          </div>

          <TextInput
            label="Name"
            placeholder={nameSuggestion}
            hint={`Leave empty to use "${nameSuggestion}".`}
            value={scope.name}
            error={fieldErrors.name}
            onChange={(event) => setScope((current) => ({ ...current, name: event.target.value }))}
          />

          <Notice tone="info">
            Continue only collects the scope. The payrun is created once you have chosen the
            employees it covers.
          </Notice>
        </div>
      ) : (
        <div className="stack">
          <div className="row">
            <input
              className="input"
              style={{ flex: 1 }}
              aria-label="Search employees"
              placeholder="Search employees…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <span className="muted">
              {selected.size} / {employees.length} selected
            </span>
          </div>

          {employees.length === 0 ? (
            <Notice tone="warning">
              Nobody has a contract covering this period, so there is nobody to pay. Check the
              contracts, or change the period.
            </Notice>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 340, overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={selected.size === employees.length && employees.length > 0}
                        onChange={(event) =>
                          setSelected(
                            event.target.checked
                              ? new Set(employees.map((employee) => employee.id))
                              : new Set()
                          )
                        }
                      />
                    </th>
                    <th>Employee</th>
                    <th>Working Hours</th>
                    <th>Contract From</th>
                    <th className="table__cell--numeric">Wage</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((employee) => (
                    <tr key={employee.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Include ${employee.name}`}
                          checked={selected.has(employee.id)}
                          onChange={() => toggle(employee.id)}
                        />
                      </td>
                      <td>
                        {employee.name}
                        {/* Flagged here rather than after computing, so it can be
                            fixed before the payrun exists. */}
                        {!employee.hasBankAccount && (
                          <>
                            {' '}
                            <StatusBadge tone="warning">no bank account</StatusBadge>
                          </>
                        )}
                      </td>
                      <td className="muted">
                        {employee.schedule} · {formatHours(employee.weeklyHours)}/week
                      </td>
                      <td className="muted">{formatDate(employee.contractStart)}</td>
                      <td className="table__cell--numeric">{formatMoney(employee.wage)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="muted">
            Only employees with a contract covering {formatDate(scope.periodStart)} to{' '}
            {formatDate(scope.periodEnd)} are listed — without one there is no wage to compute from.
          </p>
        </div>
      )}
    </Modal>
  );
}
