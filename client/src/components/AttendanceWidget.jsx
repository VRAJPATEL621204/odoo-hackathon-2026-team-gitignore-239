import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useToast } from './ToastProvider.jsx';
import { Button } from './Button.jsx';
import { formatDuration, formatTime, formatWorkedDuration } from '../lib/format.js';

/**
 * An open session must have run at least this long before it can be checked
 * out of - mirrors `MIN_CHECKOUT_MINUTES` in the server's
 * `domain/attendance.js`, which is what actually enforces it. Kept as one
 * named constant here rather than a literal `60` so the two are easy to spot
 * and update together.
 */
const MIN_CHECKOUT_MINUTES = 60;

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
 * The same tick drives the minimum-session-length gate on Check Out, so the
 * button re-enables on its own once an hour has passed, with no refresh.
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
  // somebody looking at it. Refreshed immediately on open rather than waiting
  // for the first tick, so a panel opened long after the widget mounted (and
  // therefore long after `now` was last set) does not briefly under-count the
  // elapsed time - which the checkout gate below, not just the display, relies on.
  useEffect(() => {
    if (!checkedIn || !open) return undefined;
    setNow(Date.now());
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

  // The minimum session length before Check Out is allowed - a floor on this
  // one action, not the employee's expected hours (the working schedule still
  // owns that). Ticks live off the same `now` as the elapsed-time display.
  const checkInTime = session ? new Date(session.checkIn).getTime() : null;
  const minutesSinceCheckIn = checkInTime ? Math.max(0, (now - checkInTime) / 60000) : 0;
  const canCheckOut = !checkedIn || minutesSinceCheckIn >= MIN_CHECKOUT_MINUTES;
  const checkoutUnlocksAt = checkInTime ? new Date(checkInTime + MIN_CHECKOUT_MINUTES * 60000) : null;

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
              <strong>{formatWorkedDuration(elapsedHours)}</strong>
            </div>
          ) : (
            <div className="attendance-panel__row">
              <span className="muted">No session running</span>
            </div>
          )}

          <div className="attendance-panel__row">
            <span>Today</span>
            <strong>{formatWorkedDuration(todayHours)}</strong>
          </div>

          {checkedIn && !canCheckOut && (
            <span className="muted" style={{ fontSize: 12 }}>
              You can check out at {formatTime(checkoutUnlocksAt)}.
            </span>
          )}

          <Button
            variant="primary"
            pending={pending}
            disabled={checkedIn && !canCheckOut}
            onClick={act}
          >
            {checkedIn ? 'Check Out' : 'Check In'}
          </Button>
        </div>
      )}
    </div>
  );
}
