import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { api } from '../api/client.js';
import { useResource } from '../hooks/useResource.js';
import { useDebounced } from '../hooks/useDebounced.js';
import { useOptions, toSelectOptions } from '../hooks/useOptions.js';
import { useAuth, PERMISSIONS } from '../auth/AuthProvider.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Button } from '../components/Button.jsx';
import { DataTable, Pagination } from '../components/DataTable.jsx';
import { Notice, StatusBadge } from '../components/Feedback.jsx';
import { formatDate, formatDuration, formatTime, statusTone, titleCase } from '../lib/format.js';

/**
 * Attendance, globally or for one employee.
 *
 * The employee filter lives in the query string, which is what lets the
 * Attendance smart button on the employee form be a plain link, and what makes
 * a filtered view shareable.
 */

/** Today in the browser's timezone, as the value a date input expects. */
function todayInput() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function Attendance() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const options = useOptions();

  const employeeId = params.get('employeeId') ?? '';
  const [search, setSearch] = useState('');
  const applied = useDebounced(search);
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => setPage(1), [applied, status, employeeId, from, to]);

  const list = useResource(
    (signal) =>
      api.get('/attendance', {
        signal,
        query: { search: applied, status, employeeId, from, to, page, pageSize: 15 },
      }),
    [applied, status, employeeId, from, to, page]
  );

  const focused = options.employees.find((person) => String(person.id) === employeeId);
  const showingToday = from === todayInput() && to === todayInput();

  const columns = [
    { key: 'date', header: 'Date', render: (row) => formatDate(row.date) },
    { key: 'employee', header: 'Employee', render: (row) => row.employee.name },
    {
      key: 'department',
      header: 'Department',
      render: (row) => row.employee.department?.name ?? '—',
    },
    { key: 'checkIn', header: 'Check In', render: (row) => formatTime(row.checkIn) },
    {
      key: 'checkOut',
      header: 'Check Out',
      // An open session is not missing data, it is a session still running.
      render: (row) =>
        row.checkOut ? formatTime(row.checkOut) : row.checkIn ? <em className="muted">Running</em> : '—',
    },
    {
      key: 'workedHours',
      header: 'Worked Hours',
      numeric: true,
      render: (row) => formatDuration(row.workedHours),
    },
    {
      key: 'overtimeHours',
      header: 'Overtime',
      numeric: true,
      render: (row) => (row.overtimeHours > 0 ? formatDuration(row.overtimeHours) : '—'),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <span className="row" style={{ gap: 'var(--space-2)' }}>
          <StatusBadge tone={statusTone(row.status)}>{titleCase(row.status)}</StatusBadge>
          {row.manuallyEdited && (
            <span className="muted" title="Corrected by hand">
              edited
            </span>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="stack">
      <PageHeader
        title="Attendance"
        subtitle="Check in and check out records, worked hours and exceptions."
        actions={
          can(PERMISSIONS.ATTENDANCE_WRITE) && (
            <Button
              variant="primary"
              onClick={() =>
                navigate(employeeId ? `/attendance/new?employeeId=${employeeId}` : '/attendance/new')
              }
            >
              + New
            </Button>
          )
        }
      />

      {focused && (
        <Notice tone="info">
          Showing attendance for <strong>{focused.name}</strong> only.{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              params.delete('employeeId');
              setParams(params, { replace: true });
            }}
          >
            Show everybody
          </button>
        </Notice>
      )}

      <div className="card stack">
        <div className="row">
          <input
            className="input"
            style={{ flex: 1, minWidth: 180 }}
            aria-label="Search attendance by employee"
            placeholder="Search by employee…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <select
            className="select"
            style={{ maxWidth: 180 }}
            aria-label="Filter by employee"
            value={employeeId}
            onChange={(event) => {
              if (event.target.value) params.set('employeeId', event.target.value);
              else params.delete('employeeId');
              setParams(params, { replace: true });
            }}
          >
            <option value="">All employees</option>
            {toSelectOptions(options.employees).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            className="select"
            style={{ maxWidth: 140 }}
            aria-label="Filter by status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            <option value="PRESENT">Present</option>
            <option value="LATE">Late</option>
            <option value="ABSENT">Absent</option>
          </select>
        </div>

        <div className="row">
          <Button
            size="small"
            variant={showingToday ? 'primary' : 'default'}
            onClick={() => {
              const today = todayInput();
              // Clicking Today again clears it, so the button is a toggle
              // rather than a trap.
              if (showingToday) {
                setFrom('');
                setTo('');
              } else {
                setFrom(today);
                setTo(today);
              }
            }}
          >
            Today
          </Button>

          <label className="row" style={{ gap: 'var(--space-2)' }}>
            <span className="muted">From</span>
            <input
              className="input"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>

          <label className="row" style={{ gap: 'var(--space-2)' }}>
            <span className="muted">To</span>
            <input
              className="input"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>

          {(from || to) && !showingToday && (
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setFrom('');
                setTo('');
              }}
            >
              Clear dates
            </button>
          )}
        </div>

        <DataTable
          columns={columns}
          rows={list.data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.refetch}
          onRowClick={(row) => navigate(`/attendance/${row.id}`)}
          emptyTitle="No attendance records match"
          emptyDescription="Clear the filters, or add a record for a day somebody worked."
        />

        {list.data && (
          <Pagination
            page={list.data.page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            onPageChange={setPage}
          />
        )}
      </div>
    </div>
  );
}
