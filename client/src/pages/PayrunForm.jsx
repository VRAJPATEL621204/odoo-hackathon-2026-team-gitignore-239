import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useAuth, PERMISSIONS } from '../auth/AuthProvider.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Button } from '../components/Button.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { ErrorState, Notice, StatusBadge } from '../components/Feedback.jsx';
import { formatDate, formatMoney } from '../lib/format.js';
import { payrollStatusLabel, payrollStatusTone } from '../hooks/usePayrollOptions.js';

/**
 * One payrun: the workflow buttons, and the payslips it produced.
 *
 * Draft → Compute → Validate → Mark Paid, in that order, with each button shown
 * only where it does something. Warnings are listed above the table because
 * they are what stops a payrun being validated.
 */
export function PayrunForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();

  const mayProcess = can(PERMISSIONS.PAYROLL_PROCESS);
  const [busy, setBusy] = useState(null);
  const [sendResult, setSendResult] = useState(null);

  const record = useResource((signal) => api.get(`/payroll/payruns/${id}`, { signal }), [id]);
  const payrun = record.data;

  async function act(action, request) {
    setBusy(action);
    setSendResult(null);
    try {
      const result = await request();
      record.refetch();
      return result;
    } catch (error) {
      toast.error(error?.message ?? 'That did not work.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  const compute = () =>
    act('compute', async () => {
      const result = await api.post(`/payroll/payruns/${id}/compute`);
      toast.success(`Computed ${result.payslipCount} payslip(s).`);
      return result;
    });

  const setStatus = (status, message) =>
    act(status, async () => {
      const result = await api.post(`/payroll/payruns/${id}/status`, { status });
      toast.success(message);
      return result;
    });

  const send = () =>
    act('send', async () => {
      const result = await api.post(`/payroll/payruns/${id}/send`);
      setSendResult({ queued: result.queued, pending: true });
      toast.success(`Queued ${result.queued} payslip(s) for delivery.`);
      window.setTimeout(() => record.refetch(), 2000);
      return result;
    });

  if (record.error) return <ErrorState error={record.error} onRetry={record.refetch} />;

  const columns = [
    { key: 'employee', header: 'Employee', render: (row) => row.employee.name },
    {
      key: 'warnings',
      header: 'Warning',
      render: (row) =>
        row.warnings.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          <StatusBadge tone="warning">{row.warnings.length}</StatusBadge>
        ),
    },
    {
      key: 'workedDays',
      header: 'Worked',
      numeric: true,
      render: (row) => `${row.workedDays} / ${row.totalDays}`,
    },
    { key: 'basic', header: 'Basic', numeric: true, render: (row) => formatMoney(row.basic) },
    { key: 'gross', header: 'Gross', numeric: true, render: (row) => formatMoney(row.gross) },
    { key: 'net', header: 'Net', numeric: true, render: (row) => formatMoney(row.net) },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StatusBadge tone={payrollStatusTone(row.status)}>
          {payrollStatusLabel(row.status)}
        </StatusBadge>
      ),
    },
    {
      key: 'pdf',
      header: 'PDF',
      render: (row) => (
        <a
          href={`/api/payroll/payslips/${row.id}/pdf`}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          PDF
        </a>
      ),
    },
  ];

  const withWarnings = (payrun?.payslips ?? []).filter((slip) => slip.warnings.length > 0);

  return (
    <div className="stack">
      <PageHeader
        title={payrun?.name ?? 'Payrun'}
        subtitle={
          payrun
            ? `${formatDate(payrun.periodStart)} — ${formatDate(payrun.periodEnd)} · ${payrun.structure.name}`
            : 'Loading…'
        }
        actions={<Link to="/payroll/payruns">← Back to list</Link>}
      />

      {payrun && (
        <div className="card stat-row">
          <div className="stat">
            <span className="stat__label">Status</span>
            <StatusBadge tone={payrollStatusTone(payrun.status)}>
              {payrollStatusLabel(payrun.status)}
            </StatusBadge>
          </div>
          <div className="stat">
            <span className="stat__label">Payslips</span>
            <span className="stat__value">{payrun.payslipCount}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Net Total</span>
            <span className="stat__value">{formatMoney(payrun.netTotal)}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Warnings</span>
            <span className="stat__value">{payrun.warningCount}</span>
          </div>
          {payrun.paidAt && (
            <div className="stat">
              <span className="stat__label">Paid</span>
              <span className="stat__value">{formatDate(payrun.paidAt)}</span>
            </div>
          )}
        </div>
      )}

      {payrun && mayProcess && (
        <div className="row">
          {payrun.status !== 'PAID' && (
            <Button variant="primary" pending={busy === 'compute'} onClick={compute}>
              Compute
            </Button>
          )}
          {payrun.status === 'COMPUTED' && (
            <Button
              pending={busy === 'VALIDATED'}
              onClick={() => setStatus('VALIDATED', 'Payrun validated.')}
            >
              Validate
            </Button>
          )}
          {payrun.status === 'VALIDATED' && (
            <Button
              variant="primary"
              pending={busy === 'PAID'}
              onClick={() => setStatus('PAID', 'Payrun marked paid.')}
            >
              Mark Paid
            </Button>
          )}
          {payrun.status === 'VALIDATED' && (
            <Button
              pending={busy === 'COMPUTED'}
              onClick={() => setStatus('COMPUTED', 'Payrun reopened for changes.')}
            >
              Reopen
            </Button>
          )}
          {payrun.status !== 'DRAFT' && (
            <Button pending={busy === 'send'} onClick={send}>
              Send Payslips
            </Button>
          )}
        </div>
      )}

      {payrun?.status === 'PAID' && (
        <Notice tone="success">
          This payrun is paid. It stays available as historical data and cannot be recomputed.
        </Notice>
      )}

      {withWarnings.length > 0 && (
        <Notice tone="warning">
          <strong>
            {withWarnings.length} payslip(s) need attention before this payrun can be validated.
          </strong>
          <ul style={{ margin: 'var(--space-2) 0 0', paddingLeft: 'var(--space-5)' }}>
            {withWarnings.map((slip) => (
              <li key={slip.id}>
                <Link to={`/payroll/payslips/${slip.id}`}>{slip.employee.name}</Link> —{' '}
                {slip.warnings.join(' ')}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {sendResult && (
        <Notice tone="success">
          {sendResult.pending
            ? `Queued ${sendResult.queued} payslip(s) for email delivery.`
            : `Sent ${sendResult.sent} payslip(s).`}
        </Notice>
      )}

      <div className="card stack">
        <h2>Payslips in this payrun</h2>

        <DataTable
          columns={columns}
          rows={payrun?.payslips}
          loading={record.loading}
          onRowClick={(row) => navigate(`/payroll/payslips/${row.id}`)}
          emptyTitle="No payslips"
          emptyDescription="This payrun has no employees in it."
        />
      </div>
    </div>
  );
}
