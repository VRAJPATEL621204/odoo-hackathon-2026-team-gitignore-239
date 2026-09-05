import React from 'react';

const NAVIGATION = {
  DASHBOARD: '/dashboard',
  EMPLOYEES: '/employees',
  ATTENDANCE: '/attendance',
  LEAVE: '/time-off/requests',
  PAYROLL: '/payroll/payslips',
  CONTRACTS: '/contracts',
  USERS: '/users',
};

function getContextualLink(msg) {
  const text = (msg.message || '').toLowerCase();
  const source = (msg.sources || []).join(' ').toLowerCase();

  if (text.includes('attendance') || source.includes('attendance') || msg.data?.days || msg.data?.checkInTime) {
    return { label: 'View Attendance Records', path: '/attendance' };
  }
  if (text.includes('leave') || text.includes('vacation') || source.includes('leave') || msg.data?.annual !== undefined || msg.data?.requests) {
    return { label: 'View Leave & Time Off', path: '/time-off/requests' };
  }
  if (text.includes('payroll') || text.includes('payslip') || text.includes('salary') || source.includes('payroll') || msg.data?.netSalary !== undefined) {
    return { label: 'View Payroll & Payslips', path: '/payroll/payslips' };
  }
  if (text.includes('contract') || source.includes('contract')) {
    return { label: 'View Employment Contract', path: '/contracts' };
  }
  if (text.includes('employee') || text.includes('team') || source.includes('team') || msg.data?.members) {
    return { label: 'View Employee Directory', path: '/employees' };
  }
  return null;
}

export default function Message({ msg, onConfirm, onNavigate }) {
  const { role, type, message, data, sources, verified } = msg;
  const isUser = role === 'user';
  const contextLink = !isUser ? getContextualLink(msg) : null;

  return (
    <div className={`md-chat-msg ${isUser ? 'md-chat-msg--user' : 'md-chat-msg--bot'}`}>
      <div className="md-chat-bubble">
        <p className="md-chat-text">{message}</p>

        {type === 'TABLE' && data && renderTable(data)}
        {type === 'COMPARISON' && data && renderComparison(data)}
        {type === 'CARD' && data && renderCard(data)}

        {/* Confirmation Action Button */}
        {type === 'CONFIRMATION' && msg.confirmationId && (
          <div className="md-msg-actions">
            <button className="md-btn md-btn-filled" onClick={() => onConfirm(msg.confirmationId)}>
              Confirm Action
            </button>
          </div>
        )}

        {/* Direct Navigation Trigger Button */}
        {type === 'NAVIGATION' && msg.navigationId && NAVIGATION[msg.navigationId] && (
          <div className="md-msg-actions">
            <button
              className="md-btn md-btn-tonal"
              onClick={() => onNavigate(NAVIGATION[msg.navigationId])}
            >
              <span>Open {msg.navigationId[0] + msg.navigationId.slice(1).toLowerCase()}</span>
              <span className="md-btn-arrow">→</span>
            </button>
          </div>
        )}

        {/* Contextual Quick Redirect Link */}
        {contextLink && type !== 'NAVIGATION' && onNavigate && (
          <div className="md-msg-actions">
            <button
              className="md-btn md-btn-tonal"
              onClick={() => onNavigate(contextLink.path)}
              title={`Redirect to ${contextLink.label}`}
            >
              <span>{contextLink.label}</span>
              <span className="md-btn-arrow">→</span>
            </button>
          </div>
        )}

        {!isUser && (sources?.length > 0 || verified !== undefined) && (
          <div className="md-msg-meta">
            <span className={`md-meta-badge ${verified ? 'verified' : 'guidance'}`}>
              <span className="md-badge-dot"></span>
              {verified ? 'Verified HR Record' : 'Gemini Guidance'}
            </span>
            {sources?.length > 0 && (
              <span className="md-meta-sources">Source: {sources.join(', ')}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function renderCard(data) {
  return (
    <div className="md-card-embed">
      <dl className="md-card-dl">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="md-card-row">
            <dt>{key.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase())}</dt>
            <dd>{formatValue(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function renderTable(data) {
  const rows = data.days || data.requests || data.members || [];
  if (!rows.length) return <p className="md-empty-text">No records found.</p>;
  const columns = Object.keys(rows[0]);
  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c.replace(/([A-Z])/g, ' $1').toUpperCase()}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c}>{formatValue(row[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderComparison(data) {
  const { previous, current, difference } = data;
  return (
    <div className="md-comparison-card">
      <div className="md-comp-col">
        <span className="md-comp-label">Previous</span>
        <span className="md-comp-val">{formatValue(previous?.netSalary)}</span>
      </div>
      <div className="md-comp-col">
        <span className="md-comp-label">Current</span>
        <span className="md-comp-val">{formatValue(current?.netSalary)}</span>
      </div>
      <div className="md-comp-col">
        <span className="md-comp-label">Difference</span>
        <span className={`md-comp-diff ${difference < 0 ? 'negative' : 'positive'}`}>
          {formatValue(difference)}
        </span>
      </div>
    </div>
  );
}

function formatValue(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
