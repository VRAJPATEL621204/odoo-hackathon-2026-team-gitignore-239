import { useId } from 'react';
import { NumericFormat } from 'react-number-format';

/**
 * Form controls.
 *
 * `error` is the message the API returned for this field in a 422 response, so
 * server-side validation and the visible message are always the same text.
 * There is no form library: these are plain controlled inputs.
 */

export function Field({ label, error, hint, required = false, children }) {
  return (
    <label className="field">
      <span className="field__label">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </span>
      {children}
      {hint && !error && <span className="field__hint">{hint}</span>}
      {error && <span className="field__error">{error}</span>}
    </label>
  );
}

export function TextInput({ label, error, hint, required, ...rest }) {
  return (
    <Field label={label} error={error} hint={hint} required={required}>
      <input
        className={`input${error ? ' input--invalid' : ''}`}
        aria-invalid={error ? 'true' : undefined}
        {...rest}
      />
    </Field>
  );
}

/**
 * A numeric field backed by `NumericFormat`.
 *
 * Formatting (thousand separators, a currency prefix, a percentage suffix,
 * decimal places) is display-only: `onValueChange` hands back the unformatted
 * numeric string via `values.value`, which is what callers should keep in
 * form state and send to the API, exactly as the native `type="number"`
 * inputs this replaces did with `event.target.value`.
 */
export function NumberInput({ label, error, hint, required, value, onValueChange, ...rest }) {
  return (
    <Field label={label} error={error} hint={hint} required={required}>
      <NumericFormat
        className={`input${error ? ' input--invalid' : ''}`}
        aria-invalid={error ? 'true' : undefined}
        value={value}
        onValueChange={onValueChange}
        {...rest}
      />
    </Field>
  );
}

export function TextArea({ label, error, hint, required, ...rest }) {
  return (
    <Field label={label} error={error} hint={hint} required={required}>
      <textarea
        className={`textarea${error ? ' textarea--invalid' : ''}`}
        aria-invalid={error ? 'true' : undefined}
        {...rest}
      />
    </Field>
  );
}

/** `options` is `[{ value, label }]`. `placeholder` renders an empty first choice. */
export function SelectInput({ label, error, hint, required, options = [], placeholder, ...rest }) {
  return (
    <Field label={label} error={error} hint={hint} required={required}>
      <select
        className={`select${error ? ' select--invalid' : ''}`}
        aria-invalid={error ? 'true' : undefined}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Checkbox({ label, checked, onChange, ...rest }) {
  const id = useId();
  return (
    <div className="row checkbox-row">
      <input
        id={id}
        type="checkbox"
        className="checkbox-round"
        checked={checked}
        onChange={onChange}
        {...rest}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}
