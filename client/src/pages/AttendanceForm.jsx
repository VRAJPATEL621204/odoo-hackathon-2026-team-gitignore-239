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
import {
  formatDate,
  formatDuration,
  fromDateTimeLocal,
  statusTone,
  titleCase,
  toDateTimeLocal,
} from '../lib/format.js';

/**
 * One attendance record.
 *
 * Worked hours, overtime and the present/late status are shown but never typed:
 * the server derives all three from the check-in and check-out, so a corrected
 * time produces exactly the hours the widget would have produced. Saving here
 * marks the record as manually corrected, which the dashboard reports.
 */

const EMPTY = { employeeId: '', checkIn: '', checkOut: '', date: '', status: 'PRESENT', note: '' };

export function AttendanceForm() {
  const { id } = useParams();
  const isNew = id === 'new';
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const options = useOptions();

  const editable = can(PERMISSIONS.ATTENDANCE_WRITE);

  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const record = useResource(
    (signal) => (isNew ? Promise.resolve(null) : api.get(`/attendance/${id}`, { signal })),
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
      checkIn: toDateTimeLocal(record.data.checkIn),
      checkOut: toDateTimeLocal(record.data.checkOut),
      date: record.data.date ? record.data.date.slice(0, 10) : '',
      status: record.data.status,
      note: record.data.note ?? '',
    });
  }, [record.data, isNew, params]);

  const set = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const markingAbsent = form.status === 'ABSENT';

  async function onSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    const body = {
      employeeId: Number(form.employeeId),
      // An absence has no times, so sending them would only be contradicted by
      // the server's own derivation.
      checkIn: markingAbsent ? null : fromDateTimeLocal(form.checkIn),
      checkOut: markingAbsent ? null : fromDateTimeLocal(form.checkOut),
      date: form.date === '' ? null : form.date,
      status: form.status,
      note: form.note.trim() === '' ? null : form.note.trim(),
    };

    try {
      const saved = isNew
        ? await api.post('/attendance', body)
        : await api.patch(`/attendance/${id}`, body);

      toast.success(isNew ? 'Attendance recorded.' : 'Attendance corrected.');
      if (isNew) navigate(`/attendance/${saved.id}`, { replace: true });
      else record.refetch();
    } catch (error) {
      if (error?.fields) setFieldErrors(error.fields);
      else setFormError(error?.message ?? 'Could not save the attendance record.');
    } finally {
      setSaving(false);
    }
  }

  if (record.error) return <ErrorState error={record.error} onRetry={record.refetch} />;

  const attendance = record.data;

  return (
    <div className="stack">
      <PageHeader
        title={
          attendance
            ? `${attendance.employee.name} — ${formatDate(attendance.date)}`
            : 'New Attendance Record'
        }
        subtitle="Worked hours, overtime and status are derived from the times below."
        actions={<Link to="/attendance">← Back to list</Link>}
      />

      {attendance && (
        <div className="card stat-row">
          <div className="stat">
            <span className="stat__label">Status</span>
            <StatusBadge tone={statusTone(attendance.status)}>
              {titleCase(attendance.status)}
            </StatusBadge>
          </div>
          <div className="stat">
            <span className="stat__label">Worked Hours</span>
            <span className="stat__value">{formatDuration(attendance.workedHours)}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Overtime</span>
            <span className="stat__value">{formatDuration(attendance.overtimeHours)}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Department</span>
            <span className="stat__value">{attendance.employee.department?.name ?? '—'}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Manager</span>
            <span className="stat__value">{attendance.employee.manager?.name ?? '—'}</span>
          </div>
        </div>
      )}

      {attendance?.checkIn && !attendance?.checkOut && (
        <Notice tone="warning">
          This session is still running — there is no check out yet, so it counts no worked hours.
        </Notice>
      )}

      <form className="stack" onSubmit={onSubmit} noValidate>
        {formError && <Notice tone="error">{formError}</Notice>}

        <div className="card stack">
          <div className="grid grid--2">
            <SelectInput
              label="Employee"
              required
              placeholder="Select employee"
              value={form.employeeId}
              error={fieldErrors.employeeId}
              disabled={!editable || !isNew}
              hint={isNew ? undefined : 'A record stays with the employee it was filed for.'}
              options={toSelectOptions(options.employees)}
              onChange={set('employeeId')}
            />

            <SelectInput
              label="Status"
              value={form.status}
              error={fieldErrors.status}
              disabled={!editable}
              hint="Present and Late are derived from the check-in; choose Absent to record a missed day."
              options={[
                { value: 'PRESENT', label: 'Present' },
                { value: 'LATE', label: 'Late' },
                { value: 'ABSENT', label: 'Absent' },
              ]}
              onChange={set('status')}
            />

            {markingAbsent ? (
              <TextInput
                label="Date"
                type="date"
                required
                value={form.date}
                error={fieldErrors.date}
                disabled={!editable}
                hint="An absence has no times, so the day is stated directly."
                onChange={set('date')}
              />
            ) : (
              <>
                <TextInput
                  label="Check In"
                  type="datetime-local"
                  required
                  value={form.checkIn}
                  error={fieldErrors.checkIn}
                  disabled={!editable}
                  onChange={set('checkIn')}
                />
                <TextInput
                  label="Check Out"
                  type="datetime-local"
                  value={form.checkOut}
                  error={fieldErrors.checkOut}
                  disabled={!editable}
                  hint="Leave empty while the employee is still working."
                  onChange={set('checkOut')}
                />
              </>
            )}
          </div>

          <TextArea
            label="Note"
            rows={2}
            value={form.note}
            error={fieldErrors.note}
            disabled={!editable}
            onChange={set('note')}
          />

          <p className="muted">
            {attendance?.manuallyEdited
              ? 'This record was corrected by hand. Saving again keeps that mark.'
              : 'System-generated from check in and check out. Saving marks it as manually corrected.'}
          </p>
        </div>

        {editable && (
          <div className="row">
            <Button type="submit" variant="primary" pending={saving}>
              {isNew ? 'Create Record' : 'Save Correction'}
            </Button>
            <Button onClick={() => navigate('/attendance')}>Cancel</Button>
            {attendance && (
              <Link to={`/employees/${attendance.employee.id}`} className="nav-link">
                Open employee
              </Link>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
