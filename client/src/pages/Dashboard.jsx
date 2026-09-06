import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useOptions, toSelectOptions } from '../hooks/useOptions.js';
import { useStructures } from '../hooks/usePayrollOptions.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { ErrorState, Notice, StatusBadge } from '../components/Feedback.jsx';
import { formatDuration, formatMoney } from '../lib/format.js';

/**
 * The payroll dashboard.
 *
 * Every number comes from the records the other modules created — payslips,
 * attendance, time off, contracts — so an empty period shows zeroes rather than
 * a plausible-looking invention. The filters narrow one query on the server, so
 * every block on the page always describes the same set of people.
 *
 * The charts are inline SVG and CSS. A charting library would be more code
 * shipped to the browser than the four shapes on this page are worth.
 */

/** The current month and the eleven before it, for the period picker. */
function periodOptions() {
  const now = new Date();
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const label = date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    return { value, label };
  });
}

/** A headline figure with the sentence that says where it came from. */
function Kpi({ label, value, hint, tone }) {
  return (
    <div className="kpi">
      <div className="kpi__label">{label}</div>
      <div className={`kpi__value${tone ? ` kpi__value--${tone}` : ''}`}>{value}</div>
      {hint && <div className="kpi__hint">{hint}</div>}
    </div>
  );
}

/**
 * Horizontal bars, which read better than columns for named categories.
 *
 * Capped to the top `limit` rows by value — a "cost by department" ranking is
 * naturally most useful ordered by size, and capping it is what keeps this
 * card the same rough height as its neighbours whether there are 6
 * departments or 60, instead of one card stretching the whole grid row.
 */
function BarChart({ rows, format = (value) => value, empty, limit = 8 }) {
  const max = Math.max(...rows.map((row) => row.amount), 0);
  if (rows.length === 0 || max === 0) return <p className="muted">{empty}</p>;

  const visible = rows.slice(0, limit);
  const hidden = rows.length - visible.length;

  return (
    <div className="stack stack--tight">
      <div className="bars">
        {visible.map((row) => (
          <div className="bars__row" key={row.label}>
            <span className="bars__label" title={row.label}>
              {row.label}
            </span>
            <span className="bars__track">
              <span className="bars__fill" style={{ width: `${(row.amount / max) * 100}%` }} />
            </span>
            <span className="bars__value">{format(row.amount)}</span>
          </div>
        ))}
      </div>
      {hidden > 0 && <p className="muted">+{hidden} more, smaller than these.</p>}
    </div>
  );
}

/**
 * The trend as an SVG polyline.
 *
 * Drawn against a fixed viewBox and scaled by CSS, so it stays sharp at any
 * width without measuring the container.
 */
function TrendChart({ points }) {
  const width = 320;
  const height = 110;
  const max = Math.max(...points.map((point) => point.amount), 1);

  const coordinates = points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
    const y = height - (point.amount / max) * (height - 16) - 8;
    return { x, y, ...point };
  });

  const line = coordinates.map((point) => `${point.x},${point.y}`).join(' ');
  const area = `0,${height} ${line} ${width},${height}`;

  return (
    <div className="stack stack--tight">
      <svg className="trend" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Net salary trend">
        <polygon points={area} fill="var(--color-info-bg)" />
        <polyline points={line} fill="none" stroke="var(--color-primary)" strokeWidth="2" />
        {coordinates.map((point) => (
          <circle key={point.label} cx={point.x} cy={point.y} r="3" fill="var(--color-primary)" />
        ))}
      </svg>
      <div className="trend__labels">
        {points.map((point) => (
          <span key={point.label} title={formatMoney(point.amount)}>
            {point.label.split(' ')[0]}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The payslip status split as one stacked bar plus a legend. */
function StatusSplit({ counts }) {
  const segments = [
    { key: 'PAID', label: 'Paid', value: counts.PAID, tone: 'success' },
    { key: 'DONE', label: 'Computed', value: counts.DONE, tone: 'info' },
    { key: 'DRAFT', label: 'Draft', value: counts.DRAFT, tone: 'default' },
  ];
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  if (total === 0) return <p className="muted">No payslips in this period yet.</p>;

  return (
    <div className="stack stack--tight">
      <div className="split-bar">
        {segments
          .filter((segment) => segment.value > 0)
          .map((segment) => (
            <span
              key={segment.key}
              className={`split-bar__part split-bar__part--${segment.tone}`}
              style={{ width: `${(segment.value / total) * 100}%` }}
              title={`${segment.label}: ${segment.value}`}
            />
          ))}
      </div>
      <div className="row">
        {segments.map((segment) => (
          <span key={segment.key} className="legend">
            <span className={`legend__dot legend__dot--${segment.tone}`} />
            {segment.label} {segment.value}
          </span>
        ))}
        {counts.WARNING > 0 && (
          <span className="legend">
            <StatusBadge tone="warning">{counts.WARNING} with warnings</StatusBadge>
          </span>
        )}
      </div>
    </div>
  );
}

export function Dashboard() {
  const options = useOptions();
  const { structures } = useStructures();
  const periods = periodOptions();

  const [period, setPeriod] = useState(periods[0].value);
  const [departmentId, setDepartmentId] = useState('');
  const [structureId, setStructureId] = useState('');

  const { data, loading, error, refetch } = useResource(
    (signal) => api.get('/dashboard', { signal, query: { period, departmentId, structureId } }),
    [period, departmentId, structureId]
  );

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const attendance = data?.attendance;
  const health = data?.headline.attendanceHealth;

  return (
    <div className="stack">
      <PageHeader
        title="Payroll Dashboard"
        subtitle={
          data
            ? `${data.period.label} · ${data.company}`
            : 'Payments, staffing, leave and attendance for the selected period.'
        }
      />

      <div className="card row">
        <label className="row" style={{ gap: 'var(--space-2)' }}>
          <span className="muted">Period</span>
          <select
            className="select"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          >
            {periods.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="row" style={{ gap: 'var(--space-2)' }}>
          <span className="muted">Department</span>
          <select
            className="select"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <option value="">All departments</option>
            {toSelectOptions(options.departments).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {/* An HR manager can read the dashboard but not the payroll
            configuration, so this filter has nothing to offer them and is
            hidden rather than shown empty. */}
        {structures.length > 0 && (
          <label className="row" style={{ gap: 'var(--space-2)' }}>
            <span className="muted">Employee type</span>
            <select
              className="select"
              value={structureId}
              onChange={(event) => setStructureId(event.target.value)}
            >
              <option value="">All types</option>
              {structures.map((structure) => (
                <option key={structure.id} value={structure.id}>
                  {structure.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <span className="muted" style={{ marginLeft: 'auto' }}>
          Company: {data?.company ?? '—'}
        </span>
      </div>

      {loading && !data && <p className="muted">Loading the dashboard…</p>}

      {data && (
        <>
          <div className="kpi-row">
            <Kpi
              label="Total net salary"
              value={formatMoney(data.headline.totalNetPaid)}
              hint={`${data.headline.paidCount} paid, ${data.headline.pendingCount} pending`}
            />
            <Kpi
              label="Payslips generated"
              value={data.headline.payslipCount}
              hint={`Across ${data.headline.employeeCount} active employees`}
            />
            <Kpi
              label="Average net / payslip"
              value={formatMoney(data.headline.averageNet)}
              hint="Based on this period's payroll"
            />
            <Kpi
              label="Approved time off"
              value={`${data.headline.approvedLeaveDays} days`}
              hint="Approved leave overlapping this period"
            />
            <Kpi
              label="Attendance health"
              value={health === null ? '—' : `${health}%`}
              tone={health === null ? undefined : health >= 80 ? 'good' : 'warn'}
              hint="Present and checked out, of all records"
            />
          </div>

          <div className="dash-grid">
            <div className="card stack">
              <h2>Salary cost by department</h2>
              <BarChart
                rows={data.salaryByDepartment.map((row) => ({
                  label: row.department,
                  amount: row.amount,
                }))}
                format={formatMoney}
                empty="No payroll or contracts for this selection."
              />
              <p className="muted">
                {data.headline.payslipCount > 0
                  ? 'From the payslips in this period.'
                  : 'No payroll yet for this period, so this shows the running contract wages.'}
              </p>
            </div>

            <div className="card stack">
              <h2>Monthly net salary trend</h2>
              <TrendChart points={data.trend} />
              <p className="muted">Net paid over the six months ending with this period.</p>
            </div>

            <div className="card stack">
              <h2>Payslip status and alerts</h2>
              <StatusSplit counts={data.payslipStatus} />

              <div className="stack stack--tight">
                {data.alerts.map((alert) => (
                  <div key={alert.text} className={`alert alert--${alert.tone}`}>
                    {alert.to ? <Link to={alert.to}>{alert.text}</Link> : alert.text}
                  </div>
                ))}
              </div>
            </div>

            <div className="card stack">
              <h2>Attendance overview</h2>
              <BarChart
                rows={[
                  { label: 'Present', amount: attendance.present },
                  { label: 'Late', amount: attendance.late },
                  { label: 'Absent', amount: attendance.absent },
                ]}
                empty="No attendance recorded in this period."
              />
              <div className="stack stack--tight">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="muted">Overtime recorded</span>
                  <strong>{formatDuration(attendance.overtimeHours)}</strong>
                </div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="muted">Missing check-outs</span>
                  <strong>{attendance.missingCheckOut}</strong>
                </div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="muted">Manually corrected</span>
                  <strong>{attendance.manualEdits}</strong>
                </div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="muted">Coverage of elapsed days</span>
                  <strong>{attendance.coverage === null ? '—' : `${attendance.coverage}%`}</strong>
                </div>
              </div>
            </div>

            <div className="card stack">
              <h2>Time off overview</h2>
              <div className="table-wrap table-wrap--dash">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th className="table__cell--numeric">Approved</th>
                      <th className="table__cell--numeric">Pending</th>
                      <th className="table__cell--numeric">Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.timeOff.map((row) => {
                      const balance = data.leaveBalances.find((entry) => entry.type === row.type);
                      const unit = row.unit === 'HOURS' ? 'h' : 'd';
                      return (
                        <tr key={row.type}>
                          <td>{row.type}</td>
                          <td className="table__cell--numeric">
                            {row.approved}
                            {unit}
                          </td>
                          <td className="table__cell--numeric">
                            {row.pending > 0 ? `${row.pending}${unit}` : '—'}
                          </td>
                          <td className="table__cell--numeric">
                            {/* A type needing no allocation has no balance to
                                report, which is not the same as a balance of zero. */}
                            {balance ? `${balance.remaining}${unit}` : 'n/a'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card stack">
              <h2>Department overview</h2>
              <div className="table-wrap table-wrap--dash">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Department</th>
                      <th className="table__cell--numeric">Headcount</th>
                      <th className="table__cell--numeric">Monthly cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.departments.map((row) => (
                      <tr key={row.department}>
                        <td>{row.department}</td>
                        <td className="table__cell--numeric">{row.headcount}</td>
                        <td className="table__cell--numeric">{formatMoney(row.monthlySalary)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted">
                Contract cost is the sum of running contract wages, not what was actually paid.
              </p>
            </div>
          </div>

          {data.headline.payslipCount === 0 && (
            <Notice tone="info">
              No payslips exist for {data.period.label}.{' '}
              <Link to="/payroll/payruns">Create a payrun</Link> to produce them.
            </Notice>
          )}
        </>
      )}
    </div>
  );
}
