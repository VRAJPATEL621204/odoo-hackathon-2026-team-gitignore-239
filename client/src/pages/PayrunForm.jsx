import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useCooldown } from '../hooks/useCooldown.js';
import { useAuth, PERMISSIONS } from '../auth/AuthProvider.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { ActionButton } from '../components/ActionButton.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { ErrorState, Notice, StatusBadge } from '../components/Feedback.jsx';
import { formatDate, formatMoney } from '../lib/format.js';
import { payrollStatusLabel, payrollStatusTone } from '../hooks/usePayrollOptions.js';

// Mirrors the server's default cooldown windows (ACTION_COOLDOWN_SECONDS /
// EMAIL_COOLDOWN_SECONDS). Only used to pre-emptively disable a button; the
// server enforces the real value and a 429 response corrects any mismatch.
const ACTION_COOLDOWN_SECONDS = 10;
const EMAIL_COOLDOWN_SECONDS = 5 * 60;
const PDF_COOLDOWN_SECONDS = 5;

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
  const [sendPending, setSendPending] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [pdfBusyId, setPdfBusyId] = useState(null);
  const cooldown = useCooldown();

  const record = useResource((signal) => api.get(`/payroll/payruns/${id}`, { signal }), [id]);
  const payrun = record.data;

  async function act(action, request, { cooldownKey, cooldownSeconds, optimistic } = {}) {
    setBusy(action);
    setSendResult(null);
    // Optimistic actions (sending mail) lock the button the instant the click
    // happens, rather than after the round trip — the point is to make it
    // physically impossible to fire a second send while the first is still
    // in flight, not just impossible to succeed at it.
    if (optimistic && cooldownKey) cooldown.start(cooldownKey, cooldownSeconds);
    try {
      const result = await request();
      if (cooldownKey && !optimistic) cooldown.start(cooldownKey, cooldownSeconds);
      record.refetch();
      return result;
    } catch (error) {
      if (cooldownKey && error?.status === 429 && error?.retryAfter) {
        // The server's real remaining cooldown wins over our optimistic guess.
        cooldown.start(cooldownKey, error.retryAfter);
      } else if (cooldownKey && optimistic) {
        // The action never actually happened, so the lock was never earned.
        cooldown.clear(cooldownKey);
      }
      toast.error(error?.message ?? 'That did not work.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  const compute = () =>
    act(
      'compute',
      async () => {
        const result = await api.post(`/payroll/payruns/${id}/compute`);
        toast.success(`Computed ${result.payslipCount} payslip(s).`);
        return result;
      },
      { cooldownKey: 'compute', cooldownSeconds: ACTION_COOLDOWN_SECONDS, optimistic: true }
    );

  const setStatus = (status, message) =>
    act(
      status,
      async () => {
        const result = await api.post(`/payroll/payruns/${id}/status`, { status });
        toast.success(message);
        return result;
      },
      { cooldownKey: `status:${status}`, cooldownSeconds: ACTION_COOLDOWN_SECONDS, optimistic: true }
    );

  const send = () =>
    act(
      'send',
      async () => {
        const result = await api.post(`/payroll/payruns/${id}/send`);
        setSendResult({ queued: result.queued, pending: true });
        setSendPending(true);
        toast.success(`Queued ${result.queued} payslip(s) for delivery.`);
        const poll = async () => {
          try {
            const status = await api.get(`/payroll/payruns/${id}/send-status`);
            if (status.active) {
              window.setTimeout(poll, 1000);
              return;
            }
            setSendPending(false);
            record.refetch();
          } catch {
            setSendPending(false);
            record.refetch();
          }
        };
        window.setTimeout(poll, 500);
        return result;
      },
      { cooldownKey: 'send', cooldownSeconds: EMAIL_COOLDOWN_SECONDS, optimistic: true }
    );

  /**
   * Downloads one payslip's PDF from the table row.
   *
   * A plain `<a href>` here would let the server's 429 JSON response render
   * as a bare page in the new tab instead of showing a toast, so this goes
   * through the same fetch-as-blob path as the payslip page's Print button.
   */
  async function downloadRowPdf(row) {
    const cooldownKey = `pdf:${row.id}`;
    if (pdfBusyId || cooldown.isActive(cooldownKey)) return;
    const popup = window.open('', '_blank');
    setPdfBusyId(row.id);
    cooldown.start(cooldownKey, PDF_COOLDOWN_SECONDS);
    try {
      const blob = await api.download(`/payroll/payslips/${row.id}/pdf`);
      const url = URL.createObjectURL(blob);
      if (popup) popup.location.href = url;
      else window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      popup?.close();
      if (error?.status === 429 && error?.retryAfter) cooldown.start(cooldownKey, error.retryAfter);
      else cooldown.clear(cooldownKey);
      toast.error(error?.message ?? 'Could not generate the PDF.');
    } finally {
      setPdfBusyId(null);
    }
  }

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
        <button
          type="button"
          className="button button--small"
          disabled={pdfBusyId === row.id || cooldown.isActive(`pdf:${row.id}`)}
          onClick={(event) => {
            event.stopPropagation();
            downloadRowPdf(row);
          }}
        >
          PDF
        </button>
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
            <ActionButton variant="primary" busy={busy === 'compute'} cooldownKey="compute" cooldown={cooldown} onClick={compute}>
              Compute
            </ActionButton>
          )}
          {payrun.status === 'COMPUTED' && (
            <ActionButton
              busy={busy === 'VALIDATED'}
              cooldownKey="status:VALIDATED"
              cooldown={cooldown}
              onClick={() => setStatus('VALIDATED', 'Payrun validated.')}
            >
              Validate
            </ActionButton>
          )}
          {payrun.status === 'VALIDATED' && (
            <ActionButton
              variant="primary"
              busy={busy === 'PAID'}
              cooldownKey="status:PAID"
              cooldown={cooldown}
              onClick={() => setStatus('PAID', 'Payrun marked paid.')}
            >
              Mark Paid
            </ActionButton>
          )}
          {payrun.status === 'VALIDATED' && (
            <ActionButton
              busy={busy === 'COMPUTED'}
              cooldownKey="status:COMPUTED"
              cooldown={cooldown}
              onClick={() => setStatus('COMPUTED', 'Payrun reopened for changes.')}
            >
              Reopen
            </ActionButton>
          )}
          {payrun.status !== 'DRAFT' && (
            <ActionButton busy={busy === 'send' || sendPending} cooldownKey="send" cooldown={cooldown} onClick={send}>
              Send Payslips
            </ActionButton>
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
