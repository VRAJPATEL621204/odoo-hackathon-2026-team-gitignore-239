import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useOptions, toSelectOptions } from '../hooks/useOptions.js';
import { useTimeOffTypes, unitLabel } from '../hooks/useTimeOffTypes.js';
import { useAuth, PERMISSIONS } from '../auth/AuthProvider.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Button } from '../components/Button.jsx';
import { SelectInput, TextArea, TextInput } from '../components/Field.jsx';
import { ErrorState, Notice, StatusBadge } from '../components/Feedback.jsx';
import { formatDate, toDateInput } from '../lib/format.js';
import { timeOffStatusLabel, timeOffStatusTone } from '../lib/timeoff.js';

/**
 * One time off request.
 *
 * Duration is never typed: the server counts the employee's working days
 * between the dates, so a weekend inside a range is not charged as leave. When
 * the type needs an allocation, the balance it drew on is named here, which is
 * what "clearly show which balance was consumed" asks for.
 */

const EMPTY = { employeeId: '', typeId: '', startDate: '', endDate: '', reason: '' };

export function TimeOffRequestForm() {
  const { id } = useParams();
  const isNew = id === 'new';
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can, user } = useAuth();
  const options = useOptions();
  const { types, byId } = useTimeOffTypes();

  const mayApprove = can(PERMISSIONS.TIMEOFF_APPROVE);
  const mayFileForOthers = can(PERMISSIONS.TIMEOFF_CONFIGURE);

  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deciding, setDeciding] = useState(null);

  const record = useResource(
    (signal) => (isNew ? Promise.resolve(null) : api.get(`/time-off/requests/${id}`, { signal })),
    [id]
  );

  useEffect(() => {
    if (isNew) {
      // Somebody without the officer permission may only file for themselves,
      // so their own record is preselected and locked.
      setForm({
        ...EMPTY,
        employeeId: mayFileForOthers
          ? (params.get('employeeId') ?? '')
          : String(user?.employee?.id ?? ''),
      });
      return;
    }
    if (!record.data) return;

    setForm({
      employeeId: String(record.data.employee.id),
      typeId: String(record.data.type.id),
      startDate: toDateInput(record.data.startDate),
      endDate: toDateInput(record.data.endDate),
      reason: record.data.reason ?? '',
    });
  }, [record.data, isNew, params, mayFileForOthers, user]);

  const set = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const request = record.data;
  const selectedType = byId(form.typeId);

  // The balances the chosen employee holds, so the form can say up front
  // whether the request is coverable.
  const balances = useResource(
    (signal) =>
      form.employeeId
        ? api.get(`/time-off/balances/${form.employeeId}`, { signal })
        : Promise.resolve({ items: [] }),
    [form.employeeId]
  );

  const relevantBalances = (balances.data?.items ?? []).filter(
    (balance) => !form.typeId || String(balance.type.id) === String(form.typeId)
  );

  const locked = request?.status === 'APPROVED';

  async function onSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    const body = {
      employeeId: Number(form.employeeId),
      typeId: Number(form.typeId),
      startDate: form.startDate,
      endDate: form.endDate,
      reason: form.reason.trim() === '' ? null : form.reason.trim(),
    };

    try {
      const saved = isNew
        ? await api.post('/time-off/requests', body)
        : await api.patch(`/time-off/requests/${id}`, body);

      toast.success(isNew ? 'Request submitted for approval.' : 'Request saved.');
      if (isNew) navigate(`/time-off/requests/${saved.id}`, { replace: true });
      else record.refetch();
    } catch (error) {
      if (error?.fields) setFieldErrors(error.fields);
      else setFormError(error?.message ?? 'Could not save the request.');
    } finally {
      setSaving(false);
    }
  }

  async function decide(status) {
    setDeciding(status);
    setFormError(null);
    try {
      await api.post(`/time-off/requests/${id}/status`, { status });
      toast.success(status === 'APPROVED' ? 'Request approved.' : 'Request refused.');
      record.refetch();
      balances.refetch();
    } catch (error) {
      setFormError(error?.message ?? 'Could not change the status.');
    } finally {
      setDeciding(null);
    }
  }

  if (record.error) return <ErrorState error={record.error} onRetry={record.refetch} />;

  return (
    <div className="stack">
      <PageHeader
        title={request ? `Time Off — ${request.employee.name}` : 'New Time Off Request'}
        subtitle={request ? request.type.name : 'Ask for leave. Duration is counted for you.'}
        actions={<Link to="/time-off/requests">← Back to list</Link>}
      />

      {request && (
        <div className="card stat-row">
          <div className="stat">
            <span className="stat__label">Status</span>
            <StatusBadge tone={timeOffStatusTone(request.status)}>
              {timeOffStatusLabel(request.status)}
            </StatusBadge>
          </div>
          <div className="stat">
            <span className="stat__label">Duration</span>
            <span className="stat__value">
              {request.duration} {unitLabel(request.type.unit)}
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">Period</span>
            <span className="stat__value">
              {formatDate(request.startDate)} → {formatDate(request.endDate)}
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">Approver</span>
            <span className="stat__value">{request.approver?.name ?? '—'}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Manager</span>
            <span className="stat__value">{request.employee.manager?.name ?? '—'}</span>
          </div>
        </div>
      )}

      {request?.allocation && (
        <Notice tone="info">
          Approved against allocation <strong>#{request.allocation.id}</strong> —{' '}
          {request.allocation.description ?? 'no description'}{' '}
          {request.allocation.validTo && `(valid to ${formatDate(request.allocation.validTo)})`}.{' '}
          <Link to={`/time-off/allocations/${request.allocation.id}`}>Open allocation</Link>
        </Notice>
      )}

      {request?.status === 'APPROVED' && !request.allocation && (
        <Notice tone="info">
          {request.type.name} does not require an allocation, so this leave consumed no balance.
        </Notice>
      )}

      {formError && <Notice tone="error">{formError}</Notice>}

      {request && mayApprove && (
        <div className="row">
          {request.status !== 'APPROVED' && (
            <Button
              variant="primary"
              pending={deciding === 'APPROVED'}
              onClick={() => decide('APPROVED')}
            >
              Approve
            </Button>
          )}
          {request.status !== 'REFUSED' && (
            <Button
              variant="danger"
              pending={deciding === 'REFUSED'}
              onClick={() => decide('REFUSED')}
            >
              Refuse
            </Button>
          )}
        </div>
      )}

      {locked && (
        <Notice tone="warning">
          This request is approved, so its dates are fixed. Refuse it first if it has to change.
        </Notice>
      )}

      <form className="stack" onSubmit={onSubmit} noValidate>
        <div className="card stack">
          <div className="grid grid--2">
            <SelectInput
              label="Employee"
              required
              placeholder="Select employee"
              value={form.employeeId}
              error={fieldErrors.employeeId}
              disabled={locked || !isNew || !mayFileForOthers}
              hint={
                mayFileForOthers
                  ? undefined
                  : 'You can only request time off for yourself.'
              }
              options={toSelectOptions(options.employees)}
              onChange={set('employeeId')}
            />

            <SelectInput
              label="Time Off Type"
              required
              placeholder="Select type"
              value={form.typeId}
              error={fieldErrors.typeId}
              disabled={locked}
              hint={
                selectedType
                  ? selectedType.requiresAllocation
                    ? `Measured in ${unitLabel(selectedType.unit)}; approval needs an allocation with enough left.`
                    : `Measured in ${unitLabel(selectedType.unit)}; no allocation needed.`
                  : undefined
              }
              options={types.map((type) => ({ value: String(type.id), label: type.name }))}
              onChange={set('typeId')}
            />

            <TextInput
              label="Start Date"
              type="date"
              required
              value={form.startDate}
              error={fieldErrors.startDate}
              disabled={locked}
              onChange={set('startDate')}
            />

            <TextInput
              label="End Date"
              type="date"
              required
              value={form.endDate}
              error={fieldErrors.endDate}
              disabled={locked}
              hint="Non-working days inside the range are not charged as leave."
              onChange={set('endDate')}
            />
          </div>

          <TextArea
            label="Reason"
            rows={2}
            value={form.reason}
            error={fieldErrors.reason}
            disabled={locked}
            onChange={set('reason')}
          />
        </div>

        {form.employeeId && relevantBalances.length > 0 && (
          <div className="card stack">
            <h2>Available balance</h2>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th className="table__cell--numeric">Allocated</th>
                    <th className="table__cell--numeric">Taken</th>
                    <th className="table__cell--numeric">Pending</th>
                    <th className="table__cell--numeric">Remaining</th>
                    <th>Valid to</th>
                  </tr>
                </thead>
                <tbody>
                  {relevantBalances.map((balance) => (
                    <tr key={balance.id}>
                      <td>{balance.type.name}</td>
                      <td className="table__cell--numeric">{balance.allocated}</td>
                      <td className="table__cell--numeric">{balance.taken}</td>
                      <td className="table__cell--numeric">{balance.pending}</td>
                      <td className="table__cell--numeric">
                        <strong>{balance.remaining}</strong>
                      </td>
                      <td>{balance.validTo ? formatDate(balance.validTo) : 'No end'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {form.employeeId && selectedType?.requiresAllocation && relevantBalances.length === 0 && (
          <Notice tone="warning">
            This employee holds no approved allocation for {selectedType.name}, so the request can
            be submitted but not approved.
          </Notice>
        )}

        {!locked && (
          <div className="row">
            <Button type="submit" variant="primary" pending={saving}>
              {isNew ? 'Submit Request' : 'Save'}
            </Button>
            <Button onClick={() => navigate('/time-off/requests')}>Cancel</Button>
            {request && (
              <Link to={`/employees/${request.employee.id}`} className="nav-link">
                Open employee
              </Link>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
