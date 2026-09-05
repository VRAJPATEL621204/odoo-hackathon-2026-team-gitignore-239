import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthProvider.jsx';
import { Button } from '../components/Button.jsx';
import { TextInput } from '../components/Field.jsx';
import { Notice } from '../components/Feedback.jsx';
import { validateEmail } from '../lib/validators.js';

/**
 * The sign-in screen.
 *
 * Accounts are created by an administrator, so there is no self-registration
 * here — only a way in, and a line saying where accounts come from.
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
        <div className="auth-card__brand">HR Portal</div>

        <h1 className="auth-card__title">Welcome back</h1>
        <p className="auth-card__subtitle">Sign in to continue to your workspace.</p>

        <form className="stack" onSubmit={onSubmit} noValidate>
          {formError && <Notice tone="error">{formError}</Notice>}

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
