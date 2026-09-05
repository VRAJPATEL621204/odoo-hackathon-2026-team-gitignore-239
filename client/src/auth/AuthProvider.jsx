import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api } from '../api/client.js';

const AuthContext = createContext(null);

/**
 * Holds the signed-in user for the whole application.
 *
 * On start-up it asks the server who the session cookie belongs to. The cookie
 * is httpOnly, so the browser cannot read it and this round trip is the only
 * way to know whether a session exists. A 401 is the normal answer for a
 * signed-out visitor and simply means "show the login screen".
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    api
      .get('/auth/me')
      .then((data) => {
        if (!cancelled) setUser(data.user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    setUser(data.user);
    return data.user;
  }, []);

  const signOut = useCallback(async () => {
    // Even if the call fails the local session is dropped: staying "signed in"
    // in the UI after the user asked to leave is the worse outcome.
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      checking,
      signIn,
      signOut,
      /** Permission strings come from the server, so this never re-derives roles. */
      can: (permission) => Boolean(user?.permissions?.includes(permission)),
    }),
    [user, checking, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider.');
  return context;
}

/** The permission strings the client checks. Mirrors server/src/domain/roles.js. */
export const PERMISSIONS = {
  USERS_MANAGE: 'users.manage',
  EMPLOYEES_READ: 'employees.read',
  EMPLOYEES_WRITE: 'employees.write',
  ATTENDANCE_READ: 'attendance.read',
  ATTENDANCE_WRITE: 'attendance.write',
  TIMEOFF_READ: 'timeoff.read',
  TIMEOFF_APPROVE: 'timeoff.approve',
  TIMEOFF_CONFIGURE: 'timeoff.configure',
  PAYROLL_READ: 'payroll.read',
  PAYROLL_PROCESS: 'payroll.process',
  PAYROLL_CONFIGURE: 'payroll.configure',
  DASHBOARD_READ: 'dashboard.read',
  SELF_SERVICE: 'self.service',
};
