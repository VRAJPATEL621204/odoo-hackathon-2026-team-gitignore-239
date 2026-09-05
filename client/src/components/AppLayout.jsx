import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, Link, useLocation, useNavigate } from 'react-router-dom';

import { PERMISSIONS, useAuth } from '../auth/AuthProvider.jsx';
import { AttendanceWidget } from './AttendanceWidget.jsx';

/**
 * The application shell: top navigation plus the routed page.
 *
 * The Time Off group is a dropdown because the problem statement requires
 * Requests, Allocations and Time Off Types to be reached from a single
 * "Time Off" menu rather than separate top-level buttons.
 *
 * Every entry names the permission that reveals it, so the menu a person sees
 * matches the routes they may actually open. The API enforces the same
 * permissions, so hiding an entry is a convenience, not the security boundary.
 */

const NAV = [
  {
    key: 'employees',
    label: 'Employees',
    permission: PERMISSIONS.EMPLOYEES_READ,
    items: [
      { to: '/employees', label: 'Employees' },
      { to: '/departments', label: 'Departments' },
      { to: '/job-positions', label: 'Job Positions' },
      { to: '/contracts', label: 'Contracts' },
      { to: '/schedules', label: 'Working Schedules' },
    ],
  },
  { key: 'attendance', to: '/attendance', label: 'Attendance', permission: PERMISSIONS.ATTENDANCE_READ },
  {
    key: 'time-off',
    label: 'Time Off',
    permission: PERMISSIONS.TIMEOFF_READ,
    items: [
      { to: '/time-off/requests', label: 'Requests' },
      { to: '/time-off/allocations', label: 'Allocations' },
      { to: '/time-off/types', label: 'Time Off Types' },
    ],
  },
  {
    key: 'payroll',
    label: 'Payroll',
    permission: PERMISSIONS.PAYROLL_READ,
    items: [
      { to: '/dashboard', label: 'Dashboard' },
      { to: '/payroll/payruns', label: 'Payruns' },
      { to: '/payroll/payslips', label: 'Payslips' },
      { to: '/payroll/structures', label: 'Salary Structures' },
      { to: '/payroll/rules', label: 'Salary Rules' },
    ],
  },
  { key: 'users', to: '/users', label: 'Users', permission: PERMISSIONS.USERS_MANAGE },
];

function navLinkClass({ isActive }) {
  return `nav-link${isActive ? ' is-active' : ''}`;
}

/**
 * Tracks which single dropdown is open.
 *
 * Opening one closes the others, a click anywhere outside closes them all, and
 * Escape closes the open one. The native <details> element does none of that:
 * it only toggles on its own summary, which left several panels open at once
 * covering the page.
 */
function useMenuControl() {
  const [openKey, setOpenKey] = useState(null);
  const location = useLocation();

  // Navigating away closes the menu the link was clicked in.
  useEffect(() => setOpenKey(null), [location.pathname]);

  useEffect(() => {
    if (!openKey) return undefined;

    function onPointerDown(event) {
      // A click inside the open panel — on a link, a trigger, or the widget's
      // own button — is handled by that element, so only outside clicks close
      // here. The attendance widget is one of these panels even though it is
      // not a nav menu.
      if (!event.target.closest?.('.nav-menu, .attendance-widget')) setOpenKey(null);
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setOpenKey(null);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openKey]);

  const toggle = useCallback((key) => {
    setOpenKey((current) => (current === key ? null : key));
  }, []);

  return { openKey, toggle, close: () => setOpenKey(null) };
}

function NavMenu({ id, label, items, open, onToggle, align = 'left', trigger, isActive = false }) {
  const panelRef = useRef(null);

  // Moving focus into the panel means Tab continues through the menu items
  // instead of jumping past them to the next trigger.
  useEffect(() => {
    if (open) panelRef.current?.querySelector('a, button')?.focus();
  }, [open]);

  return (
    <div className={`nav-menu${align === 'right' ? ' nav-menu--right' : ''}`}>
      <button
        type="button"
        className={`nav-menu__trigger${isActive ? ' is-active' : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={`${id}-menu`}
        onClick={() => onToggle(id)}
      >
        {trigger ?? label} <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="nav-menu__items" id={`${id}-menu`} ref={panelRef}>
          {items}
        </div>
      )}
    </div>
  );
}

/** Initials for the avatar, from the employee's name. */
function initials(name) {
  return (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

export function AppLayout() {
  const { user, can, signOut } = useAuth();
  const { openKey, toggle, close } = useMenuControl();
  const navigate = useNavigate();
  const location = useLocation();

  const visible = NAV.filter((entry) => can(entry.permission));

  async function onSignOut() {
    close();
    await signOut();
    navigate('/login', { replace: true });
  }

  /** A group is highlighted while the page shown belongs to one of its items. */
  function groupIsActive(entry) {
    return entry.items.some((item) => location.pathname.startsWith(item.to));
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/dashboard" className="topbar__brand">
          PeoplePay360
        </Link>

        <nav className="topbar__nav">
          {visible.map((entry) =>
            entry.items ? (
              <NavMenu
                key={entry.key}
                id={entry.key}
                label={entry.label}
                open={openKey === entry.key}
                onToggle={toggle}
                isActive={groupIsActive(entry)}
                items={entry.items.map((item) => (
                  <NavLink key={item.to} to={item.to} className={navLinkClass}>
                    {item.label}
                  </NavLink>
                ))}
              />
            ) : (
              <NavLink key={entry.key} to={entry.to} className={navLinkClass}>
                {entry.label}
              </NavLink>
            )
          )}
        </nav>

        <div className="topbar__right">
          {can(PERMISSIONS.SELF_SERVICE) && (
            <AttendanceWidget
              open={openKey === 'attendance'}
              onToggle={(key) => (key ? toggle(key) : close())}
            />
          )}

          <NavMenu
            id="account"
            align="right"
            label="Account"
            open={openKey === 'account'}
            onToggle={toggle}
            trigger={
              <>
                <span className="avatar">{initials(user?.employee?.name) || '?'}</span>
                <span className="user-menu__name">{user?.employee?.name ?? user?.email}</span>
              </>
            }
            items={
              <>
                <div className="user-menu__meta">
                  <div>{user?.email}</div>
                  <div className="muted">{user?.employee?.jobTitle ?? 'No job position set'}</div>
                </div>
                <NavLink to="/system" className={navLinkClass}>
                  System status
                </NavLink>
                <button type="button" className="nav-link nav-link--button" onClick={onSignOut}>
                  Sign out
                </button>
              </>
            }
          />
        </div>
      </header>

      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
