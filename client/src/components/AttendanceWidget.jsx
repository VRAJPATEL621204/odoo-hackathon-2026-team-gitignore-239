import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useToast } from './ToastProvider.jsx';
import { Button } from './Button.jsx';
import { formatDuration, formatTime } from '../lib/format.js';

/**
 * The check in / check out widget in the top bar.
 *
 * The indicator is the point of it: red when no session is open, green while
 * the employee is checked in, so the state is readable without opening
 * anything. The popup shows the running session, the total banked today, and
 * the one action that applies right now.
 *
 * The elapsed time ticks in the browser from the check-in instant rather than
 * being polled, so the number moves every second without a request per second.
 */
export function AttendanceWidget({ open, onToggle }) {
  const { user } = useAuth();
  const toast = useToast();

  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const panelRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setSummary(await api.get('/attendance/me'));
    } catch {
      // A widget that cannot reach the server simply shows nothing; the page
      // it sits on has its own error handling.
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const session = summary?.open ?? null;
  const checkedIn = Boolean(session);

  // The clock only needs to run while there is something counting up and
  // somebody looking at it.
  useEffect(() => {
    if (!checkedIn || !open) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [checkedIn, open]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!event.target.closest?.('.attendance-widget')) onToggle(null);
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') onToggle(null);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onToggle]);

  useEffect(() => {
    if (open) panelRef.current?.querySelector('button')?.focus();
  }, [open]);

  const elapsedHours = session ? Math.max(0, (now - new Date(session.checkIn).getTime()) / 3600000) : 0;
  const todayHours = (summary?.closedHours ?? 0) + elapsedHours;

  async function act() {
    setPending(true);
    try {
      const result = await api.post(
        checkedIn ? '/attendance/me/check-out' : '/attendance/me/check-in'
      );
      setSummary(result.summary);
      setNow(Date.now());
      toast.success(checkedIn ? 'Checked out.' : 'Checked in.');
    } catch (error) {
      toast.error(error?.message ?? 'Could not record attendance.');
      // Whatever went wrong, the server is the authority on the current state.
      load();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="attendance-widget">
      <button
        type="button"
        className="attendance-trigger"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={checkedIn ? 'Attendance: checked in' : 'Attendance: not checked in'}
        onClick={() => onToggle(open ? null : 'attendance')}
      >
        <span className={`status-dot${checkedIn ? ' status-dot--on' : ''}`} aria-hidden="true" />
        <span className="attendance-trigger__label">
          {loading ? '—' : formatDuration(todayHours)}
        </span>
      </button>

      {open && (
        <div className="attendance-panel" ref={panelRef}>
          <div className="attendance-panel__head">
            <span className="muted">Welcome back</span>
            <strong>{user?.employee?.name ?? user?.email}</strong>
          </div>

          {session ? (
            <div className="attendance-panel__row">
              <span>
                {formatTime(session.checkIn)} <span className="muted">— Now</span>
              </span>
              <strong>{formatDuration(elapsedHours)}</strong>
            </div>
          ) : (
            <div className="attendance-panel__row">
              <span className="muted">No session running</span>
            </div>
          )}

          <div className="attendance-panel__row">
            <span>Today</span>
            <strong>{formatDuration(todayHours)}</strong>
          </div>

          <Button variant="primary" pending={pending} onClick={act}>
            {checkedIn ? 'Check Out' : 'Check In'}
          </Button>
        </div>
      )}
    </div>
  );
}
