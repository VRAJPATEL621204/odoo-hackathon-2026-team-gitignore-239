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
 * One allocation: the grant, and the balance made of it.
 *
 * Allocated is entered; taken and remaining are summed from the approved
 * requests that drew on it, so refusing a request puts its days straight back
 * without anybody adjusting a number.
 */

const EMPTY = { employeeId: '', typeId: '', amount: '', validFrom: '', validTo: '', description: '' };

export function AllocationForm() {
  const { id } = useParams();
  const isNew = id === 'new';
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const options = useOptions();
  const { types, byId } = useTimeOffTypes();

  const editable = can(PERMISSIONS.TIMEOFF_CONFIGURE);
  const mayApprove = can(PERMISSIONS.TIMEOFF_APPROVE);

  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deciding, setDeciding] = useState(null);

  const record = useResource(
    (signal) => (isNew ? Promise.resolve(null) : api.get(`/time-off/allocations/${id}`, { signal })),
    [id]
  );

  useEffect(() => {
    if (isNew) {
      setForm({ ...EMPTY, employeeId: params.get('employeeId') ?? '' });
      return;
    }
    if (!record.data) return;

    setForm({
      employeeId: String(record.data.employee.id),
      typeId: String(record.data.type.id),
      amount: String(record.data.amount ?? ''),
      validFrom: toDateInput(record.data.validFrom),
      validTo: toDateInput(record.data.validTo),
      description: record.data.description ?? '',
    });
  }, [record.data, isNew, params]);

  const set = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const allocation = record.data;
  const unit = unitLabel(byId(form.typeId)?.unit ?? allocation?.type?.unit ?? 'DAYS');

  async function onSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    const body = {
      employeeId: Number(form.employeeId),
      typeId: Number(form.typeId),
      amount: Number(form.amount),
      validFrom: form.validFrom === '' ? null : form.validFrom,
      validTo: form.validTo === '' ? null : form.validTo,
      description: form.description.trim() === '' ? null : form.description.trim(),
    };

    try {
      const saved = isNew
        ? await api.post('/time-off/allocations', body)
        : await api.patch(`/time-off/allocations/${id}`, body);

      toast.success(isNew ? 'Allocation created.' : 'Allocation saved.');
      if (isNew) navigate(`/time-off/allocations/${saved.id}`, { replace: true });
      else record.refetch();
    } catch (error) {
      if (error?.fields) setFieldErrors(error.fields);
      else setFormError(error?.message ?? 'Could not save the allocation.');
    } finally {
      setSaving(false);
    }
  }

  async function decide(status) {
    setDeciding(status);
    setFormError(null);
    try {
      await api.post(`/time-off/allocations/${id}/status`, { status });
      toast.success(status === 'APPROVED' ? 'Allocation approved.' : 'Allocation refused.');
      record.refetch();
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
        title={allocation ? `Allocation — ${allocation.employee.name}` : 'New Allocation'}
        subtitle={allocation ? allocation.type.name : 'Grant an employee a leave balance.'}
        actions={<Link to="/time-off/allocations">← Back to list</Link>}
      />

      {allocation && (
        <div className="card stat-row">
          <div className="stat">
            <span className="stat__label">Status</span>
            <StatusBadge tone={timeOffStatusTone(allocation.status)}>
              {timeOffStatusLabel(allocation.status)}
            </StatusBadge>
          </div>
          <div className="stat">
            <span className="stat__label">Allocated</span>
            <span className="stat__value">
              {allocation.allocated} {unit}
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">Taken</span>
            <span className="stat__value">{allocation.taken}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Pending</span>
            <span className="stat__value">{allocation.pending}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Remaining</span>
            <span className="stat__value">{allocation.remaining}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Approver</span>
            <span className="stat__value">{allocation.approver?.name ?? '—'}</span>
          </div>
        </div>
      )}

      {allocation?.status === 'TO_APPROVE' && (
        <Notice tone="warning">
          This allocation is awaiting approval, so it grants no balance yet and no request can draw
          on it.
        </Notice>
      )}

      {formError && <Notice tone="error">{formError}</Notice>}

      {allocation && mayApprove && (
        <div className="row">
          {allocation.status !== 'APPROVED' && (
            <Button
              variant="primary"
              pending={deciding === 'APPROVED'}
              onClick={() => decide('APPROVED')}
            >
              Approve
            </Button>
          )}
          {allocation.status !== 'REFUSED' && (
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

      <form className="stack" onSubmit={onSubmit} noValidate>
        <div className="card stack">
          <div className="grid grid--2">
            <SelectInput
              label="Employee"
              required
              placeholder="Select employee"
              value={form.employeeId}
              error={fieldErrors.employeeId}
              disabled={!editable || !isNew}
              hint={isNew ? undefined : 'An allocation stays with the employee it was granted to.'}
              options={toSelectOptions(options.employees)}
              onChange={set('employeeId')}
            />

            <SelectInput
              label="Time Off Type"
              required
              placeholder="Select type"
              value={form.typeId}
              error={fieldErrors.typeId}
              disabled={!editable || !isNew}
              options={types.map((type) => ({ value: String(type.id), label: type.name }))}
              onChange={set('typeId')}
            />

            <TextInput
              label={`Allocated (${unit})`}
              type="number"
              min="0.5"
              step="0.5"
              required
              value={form.amount}
              error={fieldErrors.amount}
              disabled={!editable}
              onChange={set('amount')}
            />

            <TextInput
              label="Valid From"
              type="date"
              hint="Leave empty for a balance with no start date."
              value={form.validFrom}
              error={fieldErrors.validFrom}
              disabled={!editable}
              onChange={set('validFrom')}
            />

            <TextInput
              label="Valid To"
              type="date"
              hint="A request is only covered while it falls inside this validity."
              value={form.validTo}
              error={fieldErrors.validTo}
              disabled={!editable}
              onChange={set('validTo')}
            />
          </div>

          <TextArea
            label="Description"
            rows={2}
            value={form.description}
            error={fieldErrors.description}
            disabled={!editable}
            onChange={set('description')}
          />
        </div>

        {editable && (
          <div className="row">
            <Button type="submit" variant="primary" pending={saving}>
              {isNew ? 'Create Allocation' : 'Save'}
            </Button>
            <Button onClick={() => navigate('/time-off/allocations')}>Cancel</Button>
            {allocation && (
              <Link
                to={`/time-off/requests?employeeId=${allocation.employee.id}`}
                className="nav-link"
              >
                Requests drawing on this
              </Link>
            )}
          </div>
        )}
      </form>

      {allocation && (
        <p className="muted">
          Validity{' '}
          {allocation.validFrom || allocation.validTo
            ? `${formatDate(allocation.validFrom)} to ${formatDate(allocation.validTo)}`
            : 'unrestricted'}
          .
        </p>
      )}
    </div>
  );
}
