import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useOptions, toSelectOptions } from '../hooks/useOptions.js';
import { useAuth, PERMISSIONS } from '../auth/AuthProvider.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Button } from '../components/Button.jsx';
import { SelectInput, TextArea, TextInput } from '../components/Field.jsx';
import { ErrorState, Notice, StatusBadge } from '../components/Feedback.jsx';
import { formatMoney, statusTone, titleCase, toDateInput } from '../lib/format.js';

/**
 * One contract.
 *
 * The wage and the period here are what payroll reads, so the screen states
 * plainly that only a running contract is used, and the server refuses a second
 * running contract over the same days.
 */

const EMPTY = {
  employeeId: '',
  startDate: '',
  endDate: '',
  wage: '',
  status: 'DRAFT',
  departmentId: '',
  jobPositionId: '',
  workingScheduleId: '',
  notes: '',
};

export function ContractForm() {
  const { id } = useParams();
  const isNew = id === 'new';
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const options = useOptions();

  const editable = can(PERMISSIONS.EMPLOYEES_WRITE);

  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const record = useResource(
    (signal) => (isNew ? Promise.resolve(null) : api.get(`/contracts/${id}`, { signal })),
    [id]
  );

  // A contract opened from an employee's smart button starts on that employee.
  useEffect(() => {
    if (isNew) {
      setForm({ ...EMPTY, employeeId: params.get('employeeId') ?? '' });
      return;
    }
    if (!record.data) return;

    setForm({
      employeeId: String(record.data.employee.id),
      startDate: toDateInput(record.data.startDate),
      endDate: toDateInput(record.data.endDate),
      wage: String(record.data.wage ?? ''),
      status: record.data.status,
      departmentId: record.data.department ? String(record.data.department.id) : '',
      jobPositionId: record.data.jobPosition ? String(record.data.jobPosition.id) : '',
      workingScheduleId: record.data.workingSchedule ? String(record.data.workingSchedule.id) : '',
      notes: record.data.notes ?? '',
    });
  }, [record.data, isNew, params]);

  const set = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  /**
   * Copies the chosen employee's department, position and schedule onto the
   * contract, which is what they are in almost every case, while leaving them
   * editable for the cases where they are not.
   */
  function onEmployeeChange(event) {
    const employeeId = event.target.value;
    setForm((current) => ({ ...current, employeeId }));

    if (!employeeId || !isNew) return;
    api
      .get(`/employees/${employeeId}`)
      .then((employee) => {
        setForm((current) => ({
          ...current,
          departmentId: current.departmentId || (employee.department ? String(employee.department.id) : ''),
          jobPositionId:
            current.jobPositionId || (employee.jobPosition ? String(employee.jobPosition.id) : ''),
          workingScheduleId:
            current.workingScheduleId ||
            (employee.workingSchedule ? String(employee.workingSchedule.id) : ''),
        }));
      })
      .catch(() => {
        // Prefilling is a convenience; the user can still pick the values.
      });
  }

  async function onSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    const id_ = (value) => (value === '' ? null : Number(value));
    const body = {
      employeeId: Number(form.employeeId),
      startDate: form.startDate,
      endDate: form.endDate === '' ? null : form.endDate,
      wage: Number(form.wage),
      status: form.status,
      departmentId: id_(form.departmentId),
      jobPositionId: id_(form.jobPositionId),
      workingScheduleId: id_(form.workingScheduleId),
      notes: form.notes.trim() === '' ? null : form.notes.trim(),
    };

    try {
      const saved = isNew
        ? await api.post('/contracts', body)
        : await api.patch(`/contracts/${id}`, body);

      toast.success(isNew ? `Contract ${saved.reference} created.` : 'Contract saved.');
      if (isNew) navigate(`/contracts/${saved.id}`, { replace: true });
      else record.refetch();
    } catch (error) {
      if (error?.fields) setFieldErrors(error.fields);
      else setFormError(error?.message ?? 'Could not save the contract.');
    } finally {
      setSaving(false);
    }
  }

  if (record.error) return <ErrorState error={record.error} onRetry={record.refetch} />;

  const contract = record.data;

  return (
    <div className="stack">
      <PageHeader
        title={isNew ? 'New Contract' : (contract?.reference ?? 'Contract')}
        subtitle={contract ? contract.employee.name : 'Wage and period payroll will read.'}
        actions={<Link to="/contracts">← Back to list</Link>}
      />

      <form className="stack" onSubmit={onSubmit} noValidate>
        {formError && <Notice tone="error">{formError}</Notice>}

        {contract && (
          <div className="row">
            <StatusBadge tone={statusTone(contract.status)}>
              {titleCase(contract.status)}
            </StatusBadge>
            <span className="muted">
              {formatMoney(contract.wage)} per month · {contract.employee.name}
            </span>
          </div>
        )}

        <div className="card stack">
          <div className="grid grid--2">
            <SelectInput
              label="Employee"
              required
              placeholder="Select employee"
              value={form.employeeId}
              error={fieldErrors.employeeId}
              disabled={!editable || !isNew}
              hint={isNew ? undefined : 'A contract stays with the employee it was created for.'}
              options={toSelectOptions(options.employees)}
              onChange={onEmployeeChange}
            />
            <SelectInput
              label="Status"
              required
              value={form.status}
              error={fieldErrors.status}
              disabled={!editable}
              hint="Only a running contract is used by payroll."
              options={[
                { value: 'DRAFT', label: 'Draft' },
                { value: 'RUNNING', label: 'Running' },
                { value: 'EXPIRED', label: 'Expired' },
              ]}
              onChange={set('status')}
            />
            <TextInput
              label="Start Date"
              type="date"
              required
              value={form.startDate}
              error={fieldErrors.startDate}
              disabled={!editable}
              onChange={set('startDate')}
            />
            <TextInput
              label="End Date"
              type="date"
              hint="Leave empty for an open-ended contract."
              value={form.endDate}
              error={fieldErrors.endDate}
              disabled={!editable}
              onChange={set('endDate')}
            />
            <TextInput
              label="Wage / Month"
              type="number"
              min="0"
              step="0.01"
              required
              value={form.wage}
              error={fieldErrors.wage}
              disabled={!editable}
              onChange={set('wage')}
            />
            <SelectInput
              label="Working Schedule"
              placeholder="No schedule"
              value={form.workingScheduleId}
              error={fieldErrors.workingScheduleId}
              disabled={!editable}
              options={toSelectOptions(options.schedules)}
              onChange={set('workingScheduleId')}
            />
            <SelectInput
              label="Department"
              placeholder="No department"
              value={form.departmentId}
              error={fieldErrors.departmentId}
              disabled={!editable}
              options={toSelectOptions(options.departments)}
              onChange={set('departmentId')}
            />
            <SelectInput
              label="Job Position"
              placeholder="No job position"
              value={form.jobPositionId}
              error={fieldErrors.jobPositionId}
              disabled={!editable}
              options={toSelectOptions(options.jobPositions)}
              onChange={set('jobPositionId')}
            />
          </div>

          <TextArea
            label="Notes"
            rows={3}
            value={form.notes}
            error={fieldErrors.notes}
            disabled={!editable}
            onChange={set('notes')}
          />
        </div>

        {editable && (
          <div className="row">
            <Button type="submit" variant="primary" pending={saving}>
              {isNew ? 'Create Contract' : 'Save'}
            </Button>
            <Button onClick={() => navigate('/contracts')}>Cancel</Button>
            {contract && (
              <Link to={`/employees/${contract.employee.id}`} className="nav-link">
                Open employee
              </Link>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
