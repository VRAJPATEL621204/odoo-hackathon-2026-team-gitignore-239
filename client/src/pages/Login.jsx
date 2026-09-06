import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthProvider.jsx';
import { Button } from '../components/Button.jsx';
import { TextInput } from '../components/Field.jsx';
import { Notice } from '../components/Feedback.jsx';
import { validateEmail } from '../lib/validators.js';

/** The official Google "G" mark, inlined rather than pulled from an icon
 * library the project doesn't otherwise depend on — real brand colors, not a
 * redrawn approximation. */
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34A21.97 21.97 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}

/** Maps the callback's error code to the exact wording a user should see —
 * never the raw OAuth error, which could carry implementation detail. */
const GOOGLE_ERROR_MESSAGES = {
  cancelled: 'Google sign-in was cancelled.',
  unauthorized: 'This Google account is not associated with an authorized account. Please contact your administrator.',
  inactive: 'This account has been deactivated. Contact an administrator.',
  unavailable: 'Google sign-in is not available right now. Use your email and password instead.',
  failed: 'Unable to sign in with Google. Please try again.',
};

/**
 * The sign-in screen.
 *
 * Accounts are created by an administrator, so there is no self-registration
 * here — only a way in, and a line saying where accounts come from. Google is
 * a second door into the same accounts, not a separate identity system: the
 * backend only ever signs in an existing, active user matched by verified
 * email, through the same session cookie password login uses.
 */
export function Login() {
  const { user, checking, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  // Hidden until the server confirms Google is actually configured, so a
  // deployment without it never shows a button that would fail when clicked.
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [googlePending, setGooglePending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/auth/google/status')
      .then((data) => {
        if (!cancelled) setGoogleEnabled(Boolean(data?.enabled));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // The callback redirects here with ?googleError=<code> on any failure; read
  // it once, show the matching message, and drop it from the URL so a reload
  // does not keep re-showing a stale error.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get('googleError');
    if (!code) return;

    setFormError(GOOGLE_ERROR_MESSAGES[code] ?? GOOGLE_ERROR_MESSAGES.failed);
    params.delete('googleError');
    const query = params.toString();
    navigate({ pathname: location.pathname, search: query ? `?${query}` : '' }, { replace: true });
    // Only ever meant to run once, when this screen is first reached with an
    // error in the URL — not on every render, which would fight the cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleGoogleSignIn() {
    if (googlePending) return;
    setGooglePending(true);
    setFormError(null);
    // A full navigation, not a fetch: Google's consent screen has to be the
    // top-level page, not something loaded inside a request. The browser
    // leaves this page immediately, so there is nothing to reset on success —
    // only a failed attempt ever returns here to see the button again.
    window.location.href = '/api/auth/google';
  }

  if (checking) return <div className="auth-splash">Loading…</div>;

  // Someone already signed in has no use for this screen.
  if (user) return <Navigate to={location.state?.from?.pathname ?? '/'} replace />;

  async function onSubmit(event) {
    event.preventDefault();
    setFormError(null);

    const emailError = validateEmail(email, { required: true });
    if (emailError) {
      setFieldErrors({ email: emailError });
      return;
    }

    setPending(true);
    setFieldErrors({});

    try {
      await signIn(email.trim(), password);
      navigate(location.state?.from?.pathname ?? '/', { replace: true });
    } catch (error) {
      // A 422 carries per-field messages; everything else is one message about
      // the attempt as a whole, such as wrong credentials or a locked account.
      if (error?.fields) setFieldErrors(error.fields);
      else {
        setFormError(error?.message ?? 'Could not sign in.');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__brand">
          <img
            className="auth-card__brand-logo"
            src="/brand-logo.png"
            alt=""
            width="28"
            height="28"
          />
          PeoplePay360
        </div>

        <h1 className="auth-card__title">Welcome back</h1>
        <p className="auth-card__subtitle">Sign in to continue to your workspace.</p>

        <div className="stack auth-card__intro">
          {formError && <Notice tone="error">{formError}</Notice>}

          {googleEnabled && (
            <>
              <button
                type="button"
                className="button button--google"
                onClick={handleGoogleSignIn}
                disabled={googlePending}
                aria-label="Sign in with Google"
              >
                {googlePending ? <span className="spinner" aria-hidden="true" /> : <GoogleIcon />}
                {googlePending ? 'Signing in with Google…' : 'Sign in with Google'}
              </button>

              <div className="auth-divider" role="separator">
                <span>or</span>
              </div>
            </>
          )}
        </div>

        <form className="stack" onSubmit={onSubmit} noValidate>
          <TextInput
            label="Work Email"
            type="email"
            name="email"
            autoComplete="username"
            placeholder="name@company.com"
            value={email}
            error={fieldErrors.email}
            onChange={(event) => setEmail(event.target.value)}
            onBlur={() =>
              setFieldErrors((current) => ({
                ...current,
                email: validateEmail(email, { required: true }) ?? undefined,
              }))
            }
            autoFocus
            required
          />

          <TextInput
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="••••••••••"
            value={password}
            error={fieldErrors.password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />

          <Button type="submit" variant="primary" pending={pending}>
            Sign In
          </Button>
        </form>

        <div className="auth-card__footer">Accounts are created by an administrator.</div>
      </div>
    </div>
  );
}
