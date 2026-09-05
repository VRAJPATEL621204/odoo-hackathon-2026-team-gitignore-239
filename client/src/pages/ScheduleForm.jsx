import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useOptions } from '../hooks/useOptions.js';
import { useAuth, PERMISSIONS } from '../auth/AuthProvider.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Button } from '../components/Button.jsx';
import { Checkbox, SelectInput, TextInput } from '../components/Field.jsx';
import { ErrorState, Notice } from '../components/Feedback.jsx';
import { formatHours, minutesToTime, timeToMinutes } from '../lib/format.js';

/**
 * One working schedule and its weekly pattern.
 *
 * The totals at the bottom are recomputed from the rows on every keystroke, so
 * the number the user sees is always the number the server will store. Times
 * are minutes from midnight in the data and "HH:MM" in the inputs, converted
 * only at this boundary.
 */

const DEFAULT_DAY = { dayOfWeek: 0, start: '09:00', end: '18:00', breakMinutes: 60 };

/** Hours for one row, or null when the row is not yet valid. */
function rowHours(row) {
  const start = timeToMinutes(row.start);
  const end = timeToMinutes(row.end);
  if (start === null || end === null || end <= start) return null;
  const minutes = end - start - (Number(row.breakMinutes) || 0);
  return minutes <= 0 ? null : Math.round((minutes / 60) * 100) / 100;
}

export function ScheduleForm() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const { company, weekdays } = useOptions();

  const editable = can(PERMISSIONS.EMPLOYEES_WRITE);

  const [form, setForm] = useState({ name: '', timezone: 'Asia/Kolkata', active: true });
  const [rows, setRows] = useState([DEFAULT_DAY]);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const record = useResource(
    (signal) => (isNew ? Promise.resolve(null) : api.get(`/schedules/${id}`, { signal })),
    [id]
  );

  useEffect(() => {
    if (!record.data) return;
    setForm({
      name: record.data.name,
      timezone: record.data.timezone,
      active: record.data.active,
    });
    setRows(
      record.data.days.map((day) => ({
        dayOfWeek: day.dayOfWeek,
        start: minutesToTime(day.startMinutes),
        end: minutesToTime(day.endMinutes),
        breakMinutes: day.breakMinutes,
      }))
    );
  }, [record.data]);

  const totals = rows.reduce(
    (accumulator, row) => {
      const hours = rowHours(row);
      if (hours === null) return accumulator;
      accumulator.hours += hours;
      accumulator.days.add(row.dayOfWeek);
      return accumulator;
    },
    { hours: 0, days: new Set() }
  );
  const weeklyHours = Math.round(totals.hours * 100) / 100;

  function updateRow(index, patch) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    // The next unused weekday is a better guess than always adding Monday.
    const used = new Set(rows.map((row) => row.dayOfWeek));
    const next = [0, 1, 2, 3, 4, 5, 6].find((day) => !used.has(day)) ?? 0;
    setRows((current) => [...current, { ...DEFAULT_DAY, dayOfWeek: next }]);
  }

  async function onSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    const days = rows.map((row) => ({
      dayOfWeek: Number(row.dayOfWeek),
      startMinutes: timeToMinutes(row.start),
      endMinutes: timeToMinutes(row.end),
      breakMinutes: Number(row.breakMinutes) || 0,
    }));

    try {
      const body = { ...form, days };
      const saved = isNew
        ? await api.post('/schedules', body)
        : await api.patch(`/schedules/${id}`, body);

      toast.success(isNew ? 'Schedule created.' : 'Schedule saved.');
      if (isNew) navigate(`/schedules/${saved.id}`, { replace: true });
      else record.refetch();
    } catch (error) {
      if (error?.fields) setFieldErrors(error.fields);
      else setFormError(error?.message ?? 'Could not save the schedule.');
    } finally {
      setSaving(false);
    }
  }

  if (record.error) return <ErrorState error={record.error} onRetry={record.refetch} />;

  return (
    <div className="stack">
      <PageHeader
        title={isNew ? 'New Working Schedule' : (record.data?.name ?? 'Working Schedule')}
        subtitle="The weekly pattern an employee is expected to work."
        actions={<Link to="/schedules">← Back to list</Link>}
      />

      <form className="stack" onSubmit={onSubmit} noValidate>
        {formError && <Notice tone="error">{formError}</Notice>}

        <div className="card stack">
          <div className="grid grid--2">
            <TextInput
              label="Schedule Name"
              required
              value={form.name}
              error={fieldErrors.name}
              disabled={!editable}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
            <TextInput label="Company" value={company} disabled readOnly />
            <TextInput
              label="Timezone"
              value={form.timezone}
              error={fieldErrors.timezone}
              disabled={!editable}
              onChange={(event) =>
                setForm((current) => ({ ...current, timezone: event.target.value }))
              }
            />
            <div className="field">
              <span className="field__label">Status</span>
              <Checkbox
                label="Active"
                checked={form.active}
                disabled={!editable}
                onChange={(event) =>
                  setForm((current) => ({ ...current, active: event.target.checked }))
                }
              />
            </div>
          </div>
        </div>

        <div className="card stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Weekly Schedule</h2>
            {editable && (
              <Button size="small" onClick={addRow}>
                + Add Day
              </Button>
            )}
          </div>

          {fieldErrors.days && <Notice tone="error">{fieldErrors.days}</Notice>}

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Start Time</th>
                  <th>End Time</th>
                  <th>Break (minutes)</th>
                  <th className="table__cell--numeric">Hours</th>
                  {editable && <th aria-label="Remove" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const hours = rowHours(row);
                  const error = fieldErrors[`days.${index}`];
                  return (
                    <tr key={index}>
                      <td>
                        <select
                          className="select"
                          aria-label="Day of week"
                          value={row.dayOfWeek}
                          disabled={!editable}
                          onChange={(event) =>
                            updateRow(index, { dayOfWeek: Number(event.target.value) })
                          }
                        >
                          {weekdays.map((day) => (
                            <option key={day.value} value={day.value}>
                              {day.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="input"
                          type="time"
                          aria-label="Start time"
                          value={row.start}
                          disabled={!editable}
                          onChange={(event) => updateRow(index, { start: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          type="time"
                          aria-label="End time"
                          value={row.end}
                          disabled={!editable}
                          onChange={(event) => updateRow(index, { end: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          type="number"
                          min="0"
                          step="5"
                          aria-label="Break in minutes"
                          value={row.breakMinutes}
                          disabled={!editable}
                          onChange={(event) =>
                            updateRow(index, { breakMinutes: event.target.value })
                          }
                        />
                      </td>
                      <td className="table__cell--numeric">
                        {hours === null ? (
                          <span className="field__error">{error ?? 'Invalid'}</span>
                        ) : (
                          formatHours(hours)
                        )}
                      </td>
                      {editable && (
                        <td>
                          <Button
                            size="small"
                            variant="danger"
                            onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                            aria-label={`Remove row ${index + 1}`}
                          >
                            ×
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}

                {rows.length === 0 && (
                  <tr>
                    <td colSpan={editable ? 6 : 5} className="muted">
                      No working days yet. Add one to build the weekly pattern.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <strong>
              Total Weekly Hours: {formatHours(weeklyHours)} over {totals.days.size} day
              {totals.days.size === 1 ? '' : 's'}
            </strong>
          </div>
        </div>

        {editable && (
          <div className="row">
            <Button type="submit" variant="primary" pending={saving}>
              {isNew ? 'Create Schedule' : 'Save'}
            </Button>
            <Button onClick={() => navigate('/schedules')}>Cancel</Button>
          </div>
        )}
      </form>
    </div>
  );
}
