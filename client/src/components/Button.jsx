/**
 * A button that owns its own pending state.
 *
 * Only the button that was clicked shows a spinner and becomes disabled, so a
 * single save never freezes the rest of the screen, and it cannot be
 * double-submitted while the request is in flight.
 */
export function Button({
  children,
  variant = 'default',
  size = 'default',
  pending = false,
  disabled = false,
  type = 'button',
  ...rest
}) {
  const classes = ['button'];
  if (variant !== 'default') classes.push(`button--${variant}`);
  if (size === 'small') classes.push('button--small');

  return (
    <button type={type} className={classes.join(' ')} disabled={disabled || pending} {...rest}>
      {pending && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
