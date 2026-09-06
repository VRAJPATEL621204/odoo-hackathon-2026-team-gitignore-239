import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from './AuthProvider.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { Notice } from '../components/Feedback.jsx';

/**
 * Gate in front of every application route.
 *
 * While the session check is in flight nothing is rendered, otherwise a
 * signed-in user would see the login screen flash before their page appears.
 * The attempted address is remembered so the login redirects back to it.
 */
export function RequireAuth({ children }) {
  const { user, checking } = useAuth();
  const location = useLocation();

  if (checking) return <div className="auth-splash">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;

  return children;
}

/**
 * Gate for a route a role may not open.
 *
 * The menu already hides these entries; this is the check that also covers a
 * pasted or bookmarked URL, and it explains the refusal rather than
 * redirecting somewhere the user did not ask for.
 */
export function RequirePermission({ permission, anyOf, children }) {
  const { can, canAny } = useAuth();

  const allowed = anyOf ? canAny(...anyOf) : can(permission);
  if (!allowed) {
    return (
      <div className="stack">
        <PageHeader title="Not available" />
        <Notice tone="warning">
          Your roles do not give you access to this screen. Ask an administrator if you need it.
        </Notice>
      </div>
    );
  }
  return children;
}
