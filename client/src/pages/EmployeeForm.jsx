import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useOptions, toSelectOptions } from '../hooks/useOptions.js';
import { useAuth, PERMISSIONS } from '../auth/AuthProvider.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Button } from '../components/Button.jsx';
import { NumberInput, SelectInput, TextArea, TextInput } from '../components/Field.jsx';
import { ErrorState, Notice, StatusBadge } from '../components/Feedback.jsx';
import { formatDate, formatHours, formatMoney, initials, statusTone, titleCase, toDateInput } from '../lib/format.js';
import { runValidation, validateBankAccount, validateEmail, validatePhone } from '../lib/validators.js';

/**
 * One employee: their HR record, the related records reached from it, and the
 * two tabs the reference flow splits the fields into.
 *
 * Work information is what colleagues need; private information is personal
 * data and payroll detail, kept behind a second tab rather than mixed in.
 */

const EMPTY = {
  name: '',
  workEmail: '',
  workPhone: '',
  jobTitle: '',
  workLocation: '',
  departmentId: '',
  jobPositionId: '',
  managerId: '',
  workingScheduleId: '',
  status: 'ACTIVE',
  personalEmail: '',
  personalPhone: '',
  address: '',
  dateOfBirth: '',
  bankAccount: '',
};

/** Maps an API record onto the flat, all-strings shape the form edits. */
function toForm(employee) {
  return {
    name: employee.name ?? '',
    workEmail: employee.workEmail ?? '',
    workPhone: employee.workPhone ?? '',
    jobTitle: employee.jobTitle ?? '',
    workLocation: employee.workLocation ?? '',
    departmentId: employee.department ? String(employee.department.id) : '',
    jobPositionId: employee.jobPosition ? String(employee.jobPosition.id) : '',
    managerId: employee.manager ? String(employee.manager.id) : '',
    workingScheduleId: employee.workingSchedule ? String(employee.workingSchedule.id) : '',
    status: employee.status ?? 'ACTIVE',
    personalEmail: employee.personalEmail ?? '',
    personalPhone: employee.personalPhone ?? '',
    address: employee.address ?? '',
    dateOfBirth: toDateInput(employee.dateOfBirth),
    bankAccount: employee.bankAccount ?? '',
  };
}

/** Empty strings become null so a cleared field clears the column. */
function toBody(form) {
  const optional = (value) => (value.trim() === '' ? null : value.trim());
  const id = (value) => (value === '' ? null : Number(value));

  return {
    name: form.name.trim(),
    workEmail: form.workEmail.trim(),
    workPhone: optional(form.workPhone),
    jobTitle: optional(form.jobTitle),
    workLocation: optional(form.workLocation),
    departmentId: id(form.departmentId),
    jobPositionId: id(form.jobPositionId),
    managerId: id(form.managerId),
    workingScheduleId: id(form.workingScheduleId),
    status: form.status,
    personalEmail: optional(form.personalEmail),
    personalPhone: optional(form.personalPhone),
    address: optional(form.address),
    dateOfBirth: form.dateOfBirth === '' ? null : form.dateOfBirth,
    bankAccount: optional(form.bankAccount),
  };
}

/** A count next to a label, linking to the related records already filtered. */
function SmartButton({ to, label, count }) {
  return (
    <Link to={to} className="smart-button">
      <span className="smart-button__count">{count}</span>
      <span>{label}</span>
    </Link>
  );
}

export function EmployeeForm() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const options = useOptions();

  const editable = can(PERMISSIONS.EMPLOYEES_WRITE);

  const [tab, setTab] = useState('work');
  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const record = useResource(
    (signal) => (isNew ? Promise.resolve(null) : api.get(`/employees/${id}`, { signal })),
    [id]
  );

  useEffect(() => {
    if (record.data) setForm(toForm(record.data));
    if (isNew) setForm(EMPTY);
  }, [record.data, isNew]);

  const set = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  /** `formattedValue` keeps the +91 prefix the API stores alongside the digits. */
  const setPhone = (field) => (values) =>
    setForm((current) => ({ ...current, [field]: values.formattedValue }));

  /** Only digits 6-9xxxxxxxxx (a 10-digit Indian mobile number) are accepted. */
  const isAllowedPhone = (values) => values.value === '' || /^[6-9]\d{0,9}$/.test(values.value);

  // Field-level checks that mirror the server's, so a bad email or phone is
  // caught before the round trip instead of only after a 422 comes back.
  const FORM_VALIDATION = [
    ['workEmail', validateEmail, { required: true }],
    ['workPhone', validatePhone],
    ['personalEmail', validateEmail],
    ['personalPhone', validatePhone],
    ['bankAccount', validateBankAccount],
  ];

  /** Validates one field on blur, so feedback shows up before submit. */
  const validateField = (field, check, options) => () => {
    const message = check(form[field], options);
    setFieldErrors((current) => ({ ...current, [field]: message ?? undefined }));
  };

  async function onSubmit(event) {
    event.preventDefault();
    setFormError(null);

    const clientErrors = runValidation(form, FORM_VALIDATION);
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      if (['personalEmail', 'personalPhone', 'bankAccount'].some((field) => clientErrors[field])) {
        setTab('private');
      }
      return;
    }

    setSaving(true);
    setFieldErrors({});

    try {
      const body = toBody(form);
      const saved = isNew
        ? await api.post('/employees', body)
        : await api.patch(`/employees/${id}`, body);

      toast.success(isNew ? 'Employee created.' : 'Employee saved.');
      if (isNew) navigate(`/employees/${saved.id}`, { replace: true });
      else record.refetch();
    } catch (error) {
      if (error?.fields) {
        setFieldErrors(error.fields);
        // A field error on the other tab would otherwise be invisible.
        if (['personalEmail', 'personalPhone', 'address', 'dateOfBirth', 'bankAccount'].some(
          (field) => error.fields[field]
        )) {
          setTab('private');
        }
      } else {
        setFormError(error?.message ?? 'Could not save the employee.');
      }
    } finally {
      setSaving(false);
    }
  }

  if (record.error) return <ErrorState error={record.error} onRetry={record.refetch} />;

  const employee = record.data;

  return (
    <div className="stack">
      <PageHeader
        title={isNew ? 'New Employee' : (employee?.name ?? 'Employee')}
        subtitle={isNew ? 'Add somebody to the employee master.' : employee?.jobTitle}
        actions={<Link to="/employees">← Back to list</Link>}
      />

      {!isNew && employee && (
        <div className="card record-head">
          <span className="avatar avatar--xl">{initials(employee.name)}</span>

          <div className="stack stack--tight" style={{ flex: 1 }}>
            <div className="row">
              <h2>{employee.name}</h2>
              <StatusBadge tone={statusTone(employee.status)}>
                {titleCase(employee.status)}
              </StatusBadge>
            </div>
            <div className="muted">
              {[employee.jobPosition?.name ?? employee.jobTitle, employee.department?.name]
                .filter(Boolean)
                .join(' • ') || 'No job position set'}
            </div>
            <div className="muted">
              {employee.workEmail}
              {employee.workPhone ? ` | ${employee.workPhone}` : ''}
            </div>
          </div>

          <div className="smart-buttons">
            <SmartButton
              to={`/contracts?employeeId=${employee.id}`}
              label="Contracts"
              count={employee.counts.contracts}
            />
            <SmartButton
              to={`/attendance?employeeId=${employee.id}`}
              label="Attendance"
              count={employee.counts.attendance}
            />
            <SmartButton
              to={`/time-off/requests?employeeId=${employee.id}`}
              label="Time Off"
              count={employee.counts.timeOff}
            />
          </div>
        </div>
      )}

      {!isNew && employee?.runningContract && (
        <Notice tone="info">
          Running contract <strong>{employee.runningContract.reference}</strong> —{' '}
          {formatMoney(employee.runningContract.wage)} per month from{' '}
          {formatDate(employee.runningContract.startDate)}.{' '}
          <Link to={`/contracts/${employee.runningContract.id}`}>Open contract</Link>
        </Notice>
      )}

      {!isNew && employee && !employee.runningContract && (
        <Notice tone="warning">
          This employee has no running contract, so payroll has no wage to use for them.
        </Notice>
      )}

      <form className="stack" onSubmit={onSubmit} noValidate>
        {formError && <Notice tone="error">{formError}</Notice>}

        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'work'}
            className={`tab${tab === 'work' ? ' is-active' : ''}`}
            onClick={() => setTab('work')}
          >
            Work Information
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'private'}
            className={`tab${tab === 'private' ? ' is-active' : ''}`}
            onClick={() => setTab('private')}
          >
            Private Information
          </button>
        </div>

        <div className="card stack">
          {tab === 'work' ? (
            <div className="grid grid--2">
              <TextInput
                label="Employee Name"
                required
                value={form.name}
                error={fieldErrors.name}
                disabled={!editable}
                onChange={set('name')}
              />
              <TextInput
                label="Work Email"
                type="email"
                required
                value={form.workEmail}
                error={fieldErrors.workEmail}
                disabled={!editable}
                onChange={set('workEmail')}
                onBlur={validateField('workEmail', validateEmail, { required: true })}
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
              <TextInput
                label="Job Title"
                hint="Free text shown on cards and lists."
                value={form.jobTitle}
                error={fieldErrors.jobTitle}
                disabled={!editable}
                onChange={set('jobTitle')}
              />
              <SelectInput
                label="Manager"
                placeholder="No manager"
                value={form.managerId}
                error={fieldErrors.managerId}
                disabled={!editable}
                options={toSelectOptions(
                  // Somebody cannot manage themselves, so they are not offered.
                  options.employees.filter((person) => String(person.id) !== id)
                )}
                onChange={set('managerId')}
              />
              <NumberInput
                label="Work Phone"
                prefix="+91 "
                decimalScale={0}
                allowNegative={false}
                isAllowed={isAllowedPhone}
                placeholder="+91 9876543210"
                value={form.workPhone}
                error={fieldErrors.workPhone}
                disabled={!editable}
                onValueChange={setPhone('workPhone')}
                onBlur={validateField('workPhone', validatePhone)}
              />
              <TextInput
                label="Work Location"
                value={form.workLocation}
                error={fieldErrors.workLocation}
                disabled={!editable}
                onChange={set('workLocation')}
              />
              <SelectInput
                label="Working Schedule"
                placeholder="No schedule"
                hint={
                  employee?.workingSchedule
                    ? `${formatHours(employee.workingSchedule.hoursPerWeek)} over ${employee.workingSchedule.daysPerWeek} days`
                    : 'Used by attendance and payroll as the expected working time.'
                }
                value={form.workingScheduleId}
                error={fieldErrors.workingScheduleId}
                disabled={!editable}
                options={toSelectOptions(options.schedules)}
                onChange={set('workingScheduleId')}
              />
              <SelectInput
                label="Status"
                value={form.status}
                error={fieldErrors.status}
                disabled={!editable}
                options={[
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'INACTIVE', label: 'Inactive' },
                ]}
                onChange={set('status')}
              />
              <TextInput label="Company" value={options.company} disabled readOnly />
            </div>
          ) : (
            <div className="grid grid--2">
              <TextInput
                label="Personal Email"
                type="email"
                value={form.personalEmail}
                error={fieldErrors.personalEmail}
                disabled={!editable}
                onChange={set('personalEmail')}
                onBlur={validateField('personalEmail', validateEmail)}
              />
              <NumberInput
                label="Personal Phone"
                prefix="+91 "
                decimalScale={0}
                allowNegative={false}
                isAllowed={isAllowedPhone}
                placeholder="+91 9876543210"
                value={form.personalPhone}
                error={fieldErrors.personalPhone}
                disabled={!editable}
                onValueChange={setPhone('personalPhone')}
                onBlur={validateField('personalPhone', validatePhone)}
              />
              <TextInput
                label="Date of Birth"
                type="date"
                value={form.dateOfBirth}
                error={fieldErrors.dateOfBirth}
                disabled={!editable}
                onChange={set('dateOfBirth')}
              />
              <TextInput
                label="Bank Account"
                hint="Payroll cannot pay a payslip without one."
                value={form.bankAccount}
                error={fieldErrors.bankAccount}
                disabled={!editable}
                onChange={set('bankAccount')}
                onBlur={validateField('bankAccount', validateBankAccount)}
              />
              <div style={{ gridColumn: '1 / -1' }}>
                <TextArea
                  label="Address"
                  rows={3}
                  value={form.address}
                  error={fieldErrors.address}
                  disabled={!editable}
                  onChange={set('address')}
                />
              </div>
            </div>
          )}
        </div>

        {editable && (
          <div className="row">
            <Button type="submit" variant="primary" pending={saving}>
              {isNew ? 'Create Employee' : 'Save'}
            </Button>
            <Button onClick={() => navigate('/employees')}>Cancel</Button>
          </div>
        )}
      </form>
    </div>
  );
}
