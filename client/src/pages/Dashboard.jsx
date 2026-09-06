import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useOptions, toSelectOptions } from '../hooks/useOptions.js';
import { useStructures } from '../hooks/usePayrollOptions.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { EmptyState, ErrorState, Notice } from '../components/Feedback.jsx';
import { formatDuration, formatMoney, formatMoneyShort } from '../lib/format.js';

/**
 * The payroll dashboard.
 *
 * Every number comes from the records the other modules created — payslips,
 * attendance, time off, contracts — so an empty period shows zeroes rather than
 * a plausible-looking invention. The filters narrow one query on the server, so
 * every block on the page always describes the same set of people.
 *
 * The charts are inline SVG and CSS. A charting library would be more code
 * shipped to the browser than the handful of shapes on this page are worth.
 *
 * The layout follows the dashboard mock: a KPI strip, then a three-card row of
 * charts (salary by department, the trend, payslip status and alerts together),
 * then a three-card row of the attendance, time off and department breakdowns.
 */

/** A card heading with the "where this came from" line the mock puts under it. */
function CardHeader({ title, source }) {
  return (
    <header className="card__header">
      <h2>{title}</h2>
      {source && <p className="card__source">Source: {source}</p>}
    </header>
  );
}

/**
 * "+8.5% vs last month" from the trend series.
 *
 * Both months are read from the same series so the ratio is internally
 * consistent; null when there is no prior month with any payroll to divide by.
 */
function monthOverMonth(trend) {
  if (!trend || trend.length < 2) return null;
  const current = trend[trend.length - 1].amount;
  const previous = trend[trend.length - 2].amount;
  if (!previous) return null;
  const pct = Math.round(((current - previous) / previous) * 1000) / 10;
  return `${pct >= 0 ? '+' : ''}${pct}% vs last month`;
}

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
 * Horizontal bars — the right shape for a long list of named categories, where
 * the label needs room to be read and the count of rows can run into double
 * figures (a company can have a dozen departments).
 */
function BarChart({ rows, format = (value) => value, empty }) {
  const max = Math.max(...rows.map((row) => row.amount), 0);
  if (rows.length === 0 || max === 0) return <p className="muted">{empty}</p>;

  return (
    <div className="bars is-filler">
      {rows.map((row) => (
        <div className="bars__row" key={row.label} title={`${row.label}: ${format(row.amount)}`}>
          <span className="bars__label">{row.label}</span>
          <span className="bars__track">
            <span
              className={`bars__fill${row.tone ? ` bars__fill--${row.tone}` : ''}`}
              style={{ width: `${Math.max((row.amount / max) * 100, 2)}%` }}
            />
          </span>
          <span className="bars__value">{format(row.amount)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Vertical columns — for a small, fixed set of categories (the four attendance
 * buckets), drawn as columns to match the dashboard mock.
 *
 * A row may carry its own `tone` (so absences read red and overtime blue) and a
 * `display` string, for when the bar's height and the number under it are on
 * different scales — overtime is hours next to head-counts of days.
 */
function ColumnChart({ rows, format = (value) => value, empty }) {
  const max = Math.max(...rows.map((row) => row.amount), 0);
  if (rows.length === 0 || max === 0) return <p className="muted">{empty}</p>;

  return (
    <div className="columns">
      {rows.map((row) => {
        const label = row.display ?? format(row.amount);
        return (
          <div className="columns__item" key={row.label} title={`${row.label}: ${label}`}>
            <span className="columns__value">{label}</span>
            <span className="columns__track">
              <span
                className={`columns__fill${row.tone ? ` columns__fill--${row.tone}` : ''}`}
                style={{ height: `${Math.max((row.amount / max) * 100, 2)}%` }}
              />
            </span>
            <span className="columns__label">{row.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The trend as an SVG polyline.
 *
 * Drawn against a fixed viewBox and scaled by CSS, so it stays sharp at any
 * width without measuring the container. Faint horizontal guides and a max-
 * value label give it an axis to read the line against without the clutter
 * of a full grid.
 */
function TrendChart({ points, empty }) {
  const width = 320;
  const height = 110;
  const hasData = points.some((point) => point.amount > 0);
  if (!hasData) return <p className="muted">{empty}</p>;

  const max = Math.max(...points.map((point) => point.amount), 1);

  const coordinates = points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
    const y = height - (point.amount / max) * (height - 16) - 8;
    return { x, y, ...point };
  });

  const line = coordinates.map((point) => `${point.x},${point.y}`).join(' ');
  const area = `0,${height} ${line} ${width},${height}`;
  const gridLines = [0.25, 0.5, 0.75].map((fraction) => height - fraction * (height - 16) - 8);

  return (
    <div className="stack stack--tight is-filler">
      <svg className="trend" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Net salary trend">
        {gridLines.map((y) => (
          <line key={y} className="trend__grid-line" x1="0" y1={y} x2={width} y2={y} />
        ))}
        <text className="trend__axis-label" x="2" y="10">
          {formatMoney(max)}
        </text>
        <polygon points={area} fill="var(--color-info-bg)" />
        <polyline points={line} fill="none" stroke="var(--color-primary)" strokeWidth="2" />
        {coordinates.map((point) => (
          <circle key={point.label} cx={point.x} cy={point.y} r="3" fill="var(--color-primary)">
            <title>{`${point.label}: ${formatMoney(point.amount)}`}</title>
          </circle>
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

/**
 * Payslip status and the payroll alerts in one card, as the mock groups them.
 *
 * Left: the status split as a stacked bar with a legend beneath it. The bar's
 * three segments are the real statuses; "Warning" is a legend entry only,
 * because a payslip that carries a warning is also a draft or computed one and
 * a fourth segment would double-count it.
 *
 * Right: the alerts, each linking to where it is resolved.
 */
function PayslipStatusAlerts({ counts, alerts }) {
  const segments = [
    { key: 'PAID', label: 'Paid', value: counts.PAID, tone: 'success' },
    { key: 'DONE', label: 'Done', value: counts.DONE, tone: 'info' },
    { key: 'DRAFT', label: 'Pending', value: counts.DRAFT, tone: 'warning' },
  ];
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  return (
    <div className="status-alerts is-filler">
      <div className="stack stack--tight">
        <p className="card__source">Status split</p>
        {total === 0 ? (
          <EmptyState
            title="No payslips generated"
            description="No payroll has been processed for this period."
            action={<Link to="/payroll/payruns">Create a payrun</Link>}
          />
        ) : (
          <>
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
            <div className="stack stack--tight">
              {segments.map((segment) => (
                <span key={segment.key} className="legend">
                  <span className={`legend__dot legend__dot--${segment.tone}`} />
                  {segment.label} {segment.value}
                </span>
              ))}
              <span className="legend">
                <span className="legend__dot legend__dot--danger" />
                Warning {counts.WARNING}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="stack stack--tight">
        <p className="card__source">Current alerts</p>
        {alerts.map((alert) => (
          <AlertRow key={alert.text} alert={alert} />
        ))}
      </div>
    </div>
  );
}

/** Text glyph per severity, so an alert reads as a status even before the message. */
const ALERT_ICON = { danger: '!', warning: '!', success: '✓', info: 'i' };

/**
 * One payroll alert: a severity dot, the server's own message, wrapped rather
 * than stretched across a full-width bar.
 *
 * When it links somewhere, the whole row is the click target rather than just
 * the message text — a bigger, more discoverable target than an inline link,
 * with a trailing chevron so it reads as navigable before it's even hovered.
 */
function AlertRow({ alert }) {
  const icon = (
    <span className="alert__icon" aria-hidden="true">
      {ALERT_ICON[alert.tone] ?? ALERT_ICON.info}
    </span>
  );

  if (!alert.to) {
    return (
      <div className={`alert alert--${alert.tone}`}>
        {icon}
        <span className="alert__text">{alert.text}</span>
      </div>
    );
  }

  return (
    <Link to={alert.to} className={`alert alert--${alert.tone} alert--clickable`}>
      {icon}
      <span className="alert__text">{alert.text}</span>
      <span className="alert__chevron" aria-hidden="true">
        ›
      </span>
    </Link>
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
  const headline = data?.headline;
  const health = headline?.attendanceHealth;
  const salaryDelta = data ? monthOverMonth(data.trend) : null;
  const avgPerEmployee =
    headline && headline.employeeCount > 0
      ? headline.totalNetPaid / headline.employeeCount
      : null;

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
            <span className="muted">Salary structure</span>
            <select
              className="select"
              value={structureId}
              onChange={(event) => setStructureId(event.target.value)}
            >
              <option value="">All structures</option>
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
              label="Total net salary paid"
              value={formatMoney(headline.totalNetPaid)}
              hint={salaryDelta ?? `${headline.paidCount} paid, ${headline.pendingCount} pending`}
            />
            <Kpi
              label="Payslips generated"
              value={headline.payslipCount}
              hint={`${headline.paidCount} paid, ${headline.pendingCount} pending`}
            />
            <Kpi
              label="Avg salary / employee"
              value={avgPerEmployee === null ? '—' : formatMoney(avgPerEmployee)}
              hint={`Across ${headline.employeeCount} active employees`}
            />
            <Kpi
              label="Approved time off days"
              value={`${headline.approvedLeaveDays} days`}
              hint="Across the selected period"
            />
            <Kpi
              label="Attendance health"
              value={health === null ? '—' : `${health}%`}
              tone={health === null ? undefined : health >= 80 ? 'good' : 'warn'}
              hint="Present and reviewed, of all records"
            />
          </div>

          <div className="dash-row dash-row--3">
            <div className="card stack">
              <CardHeader
                title="Salary cost by department"
                source="Payslips + Employee department"
              />
              <BarChart
                rows={data.salaryByDepartment.map((row) => ({
                  label: row.department,
                  amount: row.amount,
                }))}
                format={formatMoneyShort}
                empty="No payroll or contracts for this selection."
              />
              <p className="muted">
                {headline.payslipCount > 0
                  ? 'Net salary from the payslips in this period.'
                  : 'No payroll yet for this period, so this shows the running contract wages.'}
              </p>
            </div>

            <div className="card stack">
              <CardHeader
                title="Monthly net salary trend"
                source="Historical payslips / payruns"
              />
              <TrendChart points={data.trend} empty="Not enough payroll history yet for a trend." />
              <p className="muted">Net paid over the six months ending with this period.</p>
            </div>

            <div className="card stack">
              <CardHeader
                title="Payslip status & payroll alerts"
                source="Payrun + payslip validation"
              />
              <PayslipStatusAlerts counts={data.payslipStatus} alerts={data.alerts} />
            </div>
          </div>

          <div className="dash-row dash-row--3">
            <div className="card stack">
              <CardHeader title="Attendance overview" source="Attendance" />
              <div className="stack is-filler">
                <ColumnChart
                  rows={[
                    { label: 'Present', amount: attendance.present, tone: 'success' },
                    { label: 'Late', amount: attendance.late, tone: 'warning' },
                    { label: 'Absent', amount: attendance.absent, tone: 'danger' },
                    {
                      label: 'Overtime',
                      amount: attendance.overtimeHours,
                      tone: 'info',
                      display: formatDuration(attendance.overtimeHours),
                    },
                  ]}
                  empty="No attendance recorded in this period."
                />
                <div className="stack stack--tight">
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
            </div>

            <div className="card stack">
              <CardHeader
                title="Time off overview"
                source="Time off requests + allocations"
              />
              <div className="table-wrap is-filler">
                <table className="table table--compact">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th className="table__cell--numeric">Approved</th>
                      <th className="table__cell--numeric">Pending</th>
                      <th className="table__cell--numeric">Balance</th>
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
              <CardHeader
                title="Department overview"
                source="Employee + contract + payslip totals"
              />
              <div className="table-wrap">
                <table className="table table--compact">
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
