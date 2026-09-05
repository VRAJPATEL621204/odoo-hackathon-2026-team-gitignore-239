import { Button } from './Button.jsx';
import { formatCooldown } from '../hooks/useCooldown.js';

/**
 * A Button built for optimistic actions: click locks it immediately (the
 * cooldown timer the caller started at click time), no spinner wait for a
 * round trip. The request still runs and reports through a toast; this only
 * controls what the button looks like while that happens.
 *
 * `optimistic` buttons never show the in-flight spinner — from the moment of
 * the click they go straight to disabled-with-note, because the cooldown key
 * was already started synchronously by the caller. Non-optimistic callers
 * (none left, but the option stays cheap to support) get the older
 * spinner-while-busy behaviour instead.
 */
export function ActionButton({ busy, cooldownKey, cooldown, optimistic = true, variant, onClick, children }) {
  const active = cooldown.isActive(cooldownKey);
  const pending = optimistic ? false : busy;
  const disabled = optimistic ? active : !busy && active;

  return (
    <div className="action-button">
      <Button variant={variant} pending={pending} disabled={disabled} onClick={onClick}>
        {children}
      </Button>
      {disabled && (
        <span className="action-button__note muted">
          Try again in {formatCooldown(cooldown.remaining(cooldownKey))}
        </span>
      )}
    </div>
  );
}
