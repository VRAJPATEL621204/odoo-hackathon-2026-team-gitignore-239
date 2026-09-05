import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useAuth, PERMISSIONS } from '../auth/AuthProvider.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Button } from '../components/Button.jsx';
import { ErrorState, Notice, StatusBadge } from '../components/Feedback.jsx';
import { formatDate, formatDuration, formatMoney } from '../lib/format.js';
import { categoryLabel, payrollStatusLabel, payrollStatusTone } from '../hooks/usePayrollOptions.js';

/**
 * One payslip: the figures it was computed from, and every rule that ran.
 *
 * The computation table is the point of the screen — it is what lets somebody
 * answer "why is my net this number" by reading down the rules in the order
 * they ran.
 */
export function PayslipForm() {
  const { id } = useParams();
  const toast = useToast();
  const { can } = useAuth();

  const mayProcess = can(PERMISSIONS.PAYROLL_PROCESS);
  const [busy, setBusy] = useState(null);

  const record = useResource((signal) => api.get(`/payroll/payslips/${id}`, { signal }), [id]);
  const payslip = record.data;

  async function act(action, request, message) {
    setBusy(action);
    try {
      await request();
      toast.success(message);
      record.refetch();
    } catch (error) {
      toast.error(error?.message ?? 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  if (record.error) return <ErrorState error={record.error} onRetry={record.refetch} />;

  return (
    <div className="stack">
      <PageHeader
        title={payslip ? `${payslip.employee.name} — ${payslip.reference}` : 'Payslip'}
        subtitle={
          payslip
            ? `${formatDate(payslip.periodStart)} — ${formatDate(payslip.periodEnd)} · ${payslip.structure.name}`
            : 'Loading…'
        }
        actions={<Link to="/payroll/payslips">← Back to list</Link>}
      />

      {payslip && (
        <>
          <div className="card stat-row">
            <div className="stat">
              <span className="stat__label">Status</span>
              <StatusBadge tone={payrollStatusTone(payslip.status)}>
                {payrollStatusLabel(payslip.status)}
              </StatusBadge>
            </div>
            <div className="stat">
              <span className="stat__label">Basic</span>
              <span className="stat__value">{formatMoney(payslip.basic)}</span>
            </div>
            <div className="stat">
              <span className="stat__label">Gross</span>
              <span className="stat__value">{formatMoney(payslip.gross)}</span>
            </div>
            <div className="stat">
              <span className="stat__label">Net payable</span>
              <span className="stat__value">{formatMoney(payslip.net)}</span>
            </div>
            <div className="stat">
              <span className="stat__label">Contract</span>
              <span className="stat__value">
                {payslip.contract ? (
                  <Link to={`/contracts/${payslip.contract.id}`}>{payslip.contract.reference}</Link>
                ) : (
                  '—'
                )}
              </span>
            </div>
            <div className="stat">
              <span className="stat__label">Payrun</span>
              <span className="stat__value">
                {payslip.payrun ? (
                  <Link to={`/payroll/payruns/${payslip.payrun.id}`}>{payslip.payrun.name}</Link>
                ) : (
                  '—'
                )}
              </span>
            </div>
          </div>

          {payslip.warnings.length > 0 && (
            <Notice tone="warning">
              <strong>This payslip needs attention.</strong>
              <ul style={{ margin: 'var(--space-2) 0 0', paddingLeft: 'var(--space-5)' }}>
                {payslip.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Notice>
          )}

          {payslip.status === 'PAID' && (
            <Notice tone="success">
              Paid. This payslip is the record of what was actually paid and is not recomputed.
            </Notice>
          )}

          <div className="row">
            {mayProcess && payslip.status !== 'PAID' && (
              <Button
                variant="primary"
                pending={busy === 'compute'}
                onClick={() =>
                  act(
                    'compute',
                    () => api.post(`/payroll/payslips/${id}/compute`),
                    'Payslip computed.'
                  )
                }
              >
                Compute
              </Button>
            )}

            {mayProcess && payslip.status === 'DONE' && (
              <Button
                pending={busy === 'paid'}
                onClick={() =>
                  act(
                    'paid',
                    () => api.post(`/payroll/payslips/${id}/status`, { status: 'PAID' }),
                    'Payslip marked paid.'
                  )
                }
              >
                Mark Paid
              </Button>
            )}

            <a
              className="button"
              href={`/api/payroll/payslips/${id}/pdf`}
              target="_blank"
              rel="noreferrer"
            >
              Print Payslip
            </a>

            {mayProcess && (
              <Button
                pending={busy === 'send'}
                onClick={() =>
                  act('send', () => api.post(`/payroll/payslips/${id}/send`), 'Payslip emailed.')
                }
              >
                Send by email
              </Button>
            )}
          </div>

          <div className="card stat-row">
            <div className="stat">
              <span className="stat__label">Worked Days</span>
              <span className="stat__value">
                {payslip.workedDays} / {payslip.totalDays}
              </span>
            </div>
            <div className="stat">
              <span className="stat__label">Leave Days</span>
              <span className="stat__value">{payslip.leaveDays}</span>
            </div>
            <div className="stat">
              <span className="stat__label">Unpaid Days</span>
              <span className="stat__value">{payslip.unpaidDays}</span>
            </div>
            <div className="stat">
              <span className="stat__label">Overtime</span>
              <span className="stat__value">{formatDuration(payslip.overtimeHours)}</span>
            </div>
            <div className="stat">
              <span className="stat__label">Computed</span>
              <span className="stat__value">
                {payslip.computedAt ? formatDate(payslip.computedAt) : 'Not yet'}
              </span>
            </div>
            <div className="stat">
              <span className="stat__label">Sent</span>
              <span className="stat__value">
                {payslip.sentAt ? formatDate(payslip.sentAt) : 'Not sent'}
              </span>
            </div>
          </div>

          <div className="card stack">
            <h2>Salary computation</h2>

            {payslip.lines.length === 0 ? (
              <Notice tone="info">
                This payslip has not been computed yet, so it has no lines. Use Compute above.
              </Notice>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Rule</th>
                      <th>Category</th>
                      <th>Code</th>
                      <th className="table__cell--numeric">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payslip.lines.map((line) => (
                      <tr key={line.id}>
                        <td>{line.name}</td>
                        <td className="muted">{categoryLabel(line.category)}</td>
                        <td>
                          <code className="mono">{line.code}</code>
                        </td>
                        <td
                          className="table__cell--numeric"
                          style={line.amount < 0 ? { color: 'var(--color-danger)' } : undefined}
                        >
                          {formatMoney(line.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>
                        <strong>Net payable</strong>
                      </td>
                      <td className="table__cell--numeric">
                        <strong>{formatMoney(payslip.net)}</strong>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <p className="muted">
              Rules ran in sequence order. Each one could read the totals the rules above it
              produced, which is how a percentage of basic or a sum of a category is possible.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
